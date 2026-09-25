/**
 * FightRoom — авторитетный хост боя 1v1.
 *
 * Вся геометрия/здоровье/фазы живут в детерминированном sim (packages/shared),
 * который сервер продвигает фиксированным шагом. Клиенты шлют фреймы ввода
 * (seq + 16-бит. слово), сервер накапливает их в буфер на место и за тик
 * применяет ровно один вход на бойца. Снапшоты мира (20 Гц) и события фаз
 * рассылаются по бинарному каналу (см. shared/net/pack.ts).
 *
 * Мост в UI/лобби — FightRoomState (schema Colyseus), меняется редко.
 */
import { Room, type Client, CloseCode } from '@colyseus/core';
import {
  MAX_PLAYERS,
  SIM_HZ,
  SNAPSHOT_HZ,
  RECONNECT_GRACE_MS,
  Opcode,
  FightRoomState,
  createWorld,
  stepWorld,
  packWorld,
  packEvent,
  packMatchResult,
  packOpponentStatus,
  decodeInputMessage,
} from '@sf/shared';
import { matchStore } from '../store/JsonMatchStore';

const STEP_MS = 1000 / SIM_HZ;
const SNAP_EVERY = SIM_HZ / SNAPSHOT_HZ; // каждый 3-й симуляционный тик
const MAX_PENDING_INPUTS = 180; // защита от лавинного баффера (~3 секунды)

interface Seat {
  sessionId: string;
  client: Client | null; // null в момент ожидания переподключения
  disconnected: boolean;
  lastWord: number;
  prevWord: number;
  pending: { seq: number; word: number }[];
  lastSeq: number;
}

export class FightRoom extends Room<{ state: FightRoomState }> {
  private seats: Seat[] = [];
  private world = createWorld(1);
  private simAccum = 0;
  private ending = false;
  private startedAt = Date.now();
  private names = new Map<string, string>();

  override onCreate(): void {
    this.maxClients = MAX_PLAYERS;
    this.setState(new FightRoomState());
    this.startedAt = Date.now();
    this.world = createWorld(Math.floor(Date.now() % 100000));
    this.syncSchema('countdown');

    this.setTimestep((dtMs = STEP_MS) => this.tick(dtMs), STEP_MS);

    this.onMessageBytes(Opcode.InputFrame, (client: Client, msg: unknown) => {
      const seat = this.seatBySession(client.sessionId);
      if (!seat) return;
      let bytes: Uint8Array;
      try {
        bytes = toBytes(msg);
      } catch {
        return;
      }
      const { seq, word } = decodeInputMessage(bytes);
      // отбрасываем повторы/устаревшие (seq по модулю 65536, окно 180)
      const back = (seat.lastSeq - seq) & 0xffff;
      if (back > 30000 && back < 50000) return;
      seat.pending.push({ seq, word });
      if (seat.pending.length > MAX_PENDING_INPUTS) seat.pending.shift();
      seat.lastSeq = seq;
    });
  }

  override onJoin(client: Client, options?: { name?: string }): void {
    const name = String(options?.name ?? `player_${client.sessionId.slice(-4)}`);
    this.names.set(client.sessionId, name);
    // место для нового игрока: свободный слот, либо слот «отвалившегося»
    const free = this.seats.find((s) => s.disconnected && s.client === null);
    let seat: Seat;
    if (free) {
      seat = free;
      seat.sessionId = client.sessionId;
      seat.disconnected = false;
      seat.lastWord = 0;
      seat.prevWord = 0;
      seat.pending = [];
    } else if (this.seats.length < MAX_PLAYERS) {
      seat = {
        sessionId: client.sessionId,
        client,
        disconnected: false,
        lastWord: 0,
        prevWord: 0,
        pending: [],
        lastSeq: 0,
      };
      this.seats.push(seat);
    } else {
      // мест нет — Colyseus не пустит нас сюда (maxClients), но на всякий случай
      client.leave(4000, 'room full');
      return;
    }
    seat.client = client;
    client.sendBytes(Opcode.Snapshot, packWorld(this.world));
    this.syncSchema(this.world.phase);
    // НИКАКОЙ отправки welcome вручную — клиент ждёт первый снапшот.
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    const found = this.seatBySession(client.sessionId);
    if (!found) return;
    const seat: Seat = found;
    const consented = code === CloseCode.CONSENTED;
    if (consented || this.ending) {
      seat.client = null;
      seat.disconnected = true;
      if (!this.ending) this.handleSitout(seat);
    } else {
      // ждём возврата в течение grace-окна
      try {
        const reconnected = (await this.allowReconnection(
          client,
          RECONNECT_GRACE_MS / 1000,
        )) as unknown as Client;
        seat.client = reconnected;
        seat.disconnected = false;
        seat.lastWord = 0;
        seat.prevWord = 0;
        seat.pending = [];
        const other = this.seats.find((s) => s !== seat && s.client);
        if (other) {
          other.client?.sendBytes(Opcode.OpponentStatus, packOpponentStatus('reconnect'));
        }
      } catch {
        // игрок не вернулся
        seat.client = null;
        seat.disconnected = true;
        this.handleSitout(seat);
      }
    }
  }

  private tick(dtMs: number): void {
    if (this.ending) return;
    this.simAccum += Math.max(0, Math.min(STEP_MS * 4, dtMs));
    let steps = 0;
    const canPlay =
      this.seats.length === MAX_PLAYERS && this.seats.every((s) => s.client && !s.disconnected);
    while (this.simAccum >= STEP_MS && steps < 5) {
      this.simAccum -= STEP_MS;
      if (canPlay) this.stepSim();
      steps += 1;
    }
    if (this.ending) return;
    if (!canPlay && this.seats.some((s) => s.disconnected)) {
      // пауза, пока соперник не вернётся — состояние «не в бою» отражено в schema
      this.syncSchema(this.world.phase);
    }
  }

  private stepSim(): void {
    const inputs: [number, number] = [0, 0];
    const prev: [number, number] = [0, 0];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const seat = this.seats[i] as Seat;
      const next = seat.pending.shift();
      if (next) seat.lastWord = next.word;
      inputs[i] = seat.lastWord;
      prev[i] = seat.prevWord;
      seat.prevWord = seat.lastWord;
    }

    const events = stepWorld(this.world, inputs, prev);

    for (const client of this.clients) {
      if (this.world.tick % SNAP_EVERY === 0) {
        const seatIdx = this.seats.findIndex((s) => s.sessionId === client.sessionId);
        if (seatIdx >= 0) {
          client.sendBytes(Opcode.Side, Uint8Array.of(seatIdx));
        }
        client.sendBytes(Opcode.Snapshot, packWorld(this.world));
      }
    }
    for (const ev of events) {
      this.syncSchema(this.world.phase);
      if (ev.type === 'matchend') {
        this.finishMatch(ev.winner, 'ko');
        return;
      }
      this.broadcastBytes(Opcode.RoundEvent, packEvent(ev), {});
    }
  }

  private finishMatch(winner: number, _reason: 'ko' | 'time' | 'dq'): void {
    if (this.ending) return;
    this.ending = true;
    this.syncSchema('matchend');
    // Персистентность результата (JSONL; сбои диска не роняют бой).
    matchStore().record({
      id: `${this.roomId}-${Date.now()}`,
      roomId: this.roomId,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      durationMs: Date.now() - this.startedAt,
      winner: winner as 0 | 1,
      reason: _reason,
      wins: [this.world.wins[0], this.world.wins[1]],
      players: this.seats.map((s) => ({
        sessionId: s.sessionId,
        name: this.names.get(s.sessionId) ?? 'unknown',
      })),
    });
    const result = packMatchResult(winner as 0 | 1, [this.world.wins[0], this.world.wins[1]]);
    for (const client of this.clients) {
      client.sendBytes(Opcode.MatchResult, result);
    }
    setTimeout(() => {
      void this.disconnect(CloseCode.CONSENTED);
    }, 3000);
  }

  private handleSitout(seat: Seat): void {
    if (this.ending || !this.world) return;
    const other = this.seats.find((s) => s !== seat && s.client && !s.disconnected);
    if (!other) return;
    const winner = this.seatIndex(other) as 0 | 1;
    other.client?.sendBytes(Opcode.OpponentStatus, packOpponentStatus('dq'));
    this.finishMatch(winner, 'dq');
  }

  private seatBySession(sessionId: string): Seat | undefined {
    return this.seats.find((s) => s.sessionId === sessionId);
  }

  private seatIndex(seat: Seat): number {
    return this.seats.indexOf(seat);
  }

  private syncSchema(phase: string): void {
    const idx = ['countdown', 'fight', 'roundend', 'matchend'].indexOf(phase);
    this.state.phase = idx >= 0 ? idx : 0;
    this.state.round = this.world ? this.world.round : 0;
    this.state.players = this.seats.filter((s) => s.client && !s.disconnected).length;
    this.state.result = 0;
  }
}

function toBytes(msg: unknown): Uint8Array {
  if (msg instanceof Uint8Array) return msg;
  if (msg instanceof ArrayBuffer) return new Uint8Array(msg);
  if (ArrayBuffer.isView(msg)) {
    const v = msg as Uint8Array;
    return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  }
  throw new Error('bad input payload');
}