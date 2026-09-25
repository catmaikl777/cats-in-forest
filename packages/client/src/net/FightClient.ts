import { Client, type Room } from '@colyseus/sdk';
import {
  Opcode,
  FightRoomState,
  FightWorld,
  FightEvent,
  Side,
  SIM_HZ,
  INPUT_HZ,
  packInputFrame,
  cloneWorld,
  stepWorld,
  unpackWorld,
  unpackEvent,
  unpackMatchResult,
  opponentStatusKind,
} from '@sf/shared';

/** Публичный интерфейс событий боя для сцены/ловби. */
export interface FightClientHandlers {
  /** Каждый локальный прогнозный тик (60 Гц) — источник рендера. */
  onTick: (world: FightWorld, mySide: Side) => void;
  /** Итог матча. */
  onResult: (result: { winner: Side; wins: [number, number] }) => void;
  onError: (message: string) => void;
  onLeave: () => void;
}

export type FightStatus = 'connecting' | 'waiting' | 'fight' | 'result' | 'error';

/**
 * FightClient — бинарный сетевой слой боя + лёгкий предсказание/rollback.
 *
 * Сцена гонит свой локальный симулятор тем же фиксированным шагом, что и
 * сервер: каждый тик в неё подаётся текущее слово ввода (джойстик/кнопки) и
 * «экстраполяция» соперника (последнее известное — на практике idle). Каждый
 * пришедший авторитетный снапшот (20 Гц) становится якорем: если наше
 * предсказание уже ушло вперёд, откатываемся к авторитетному состоянию и
 * проигрываем локальные входы заново (rollback-window ≤ 30 тиков).
 */
export class FightClient {
  private client: Client | null = null;
  private room: Room<any, FightRoomState> | null = null;

  private handlers: FightClientHandlers | null = null;
  private mySide: Side = 0;
  private local: FightWorld | null = null;
  private mePrev = 0;
  private oppPrev = 0;
  /** Последнее известное слово соперника (у нас его нет — держим idle). */
  private oppWord = 0;

  /** Очередь авторитетных игровых событий (опустошается сценой в update). */
  private eventQueue: FightEvent[] = [];
  private statusQueue: string[] = [];

  /** История наших слов по тикам (ме=tick, для rollback-replay). */
  private history: { tick: number; word: number }[] = [];
  private readonly MAX_REPLAY = 30;

  private inputWord = 0;
  private seq = 0;

  private inputTimer: ReturnType<typeof setInterval> | null = null;
  private predictTimer: ReturnType<typeof setInterval> | null = null;

  status: FightStatus = 'connecting';
  serverUrl = '';
  roomId = '';
  sessionId = '';
  lastError: string | null = null;
  result: { winner: Side; wins: [number, number] } | null = null;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  /** Регистрирует обработчики мир-событий (сцена) до/в момент connecting. */
  setHandlers(h: FightClientHandlers): void {
    this.handlers = h;
  }

  setStatus(s: FightStatus): void {
    this.status = s;
  }

  /** Актуальное слово ввода от виртуального джойстика. */
  setInput(word: number): void {
    this.inputWord = word;
  }

  get side(): Side {
    return this.mySide;
  }

  latest(): FightWorld | null {
    return this.local;
  }

  /** Очередь событий для сцены (дренируется каждый кадр). */
  drainEvents(): FightEvent[] {
    const out = this.eventQueue;
    this.eventQueue = [];
    return out;
  }

  drainOpponentStatus(): string[] {
    const out = this.statusQueue;
    this.statusQueue = [];
    return out;
  }

  async findMatch(playerName: string): Promise<void> {
    this.client = new Client(this.serverUrl);
    const room = await this.client.joinOrCreate<FightRoomState>(
      'fight',
      { name: playerName },
      FightRoomState,
    );
    this.room = room;
    this.roomId = room.roomId;
    this.sessionId = room.sessionId;

    room.onMessage(Opcode.Side, (bytes: Uint8Array) => {
      const b0 = new Uint8Array(bytes);
      if (b0[0] === 0 || b0[0] === 1) this.mySide = b0[0] as Side;
    });
    room.onMessage(Opcode.Snapshot, (bytes: Uint8Array) => this.onSnapshot(unpackWorld(bytes)));
    room.onMessage(Opcode.RoundEvent, (bytes: Uint8Array) => {
      this.eventQueue.push(unpackEvent(bytes));
    });
    room.onMessage(Opcode.MatchResult, (bytes: Uint8Array) => {
      const r = unpackMatchResult(bytes);
      this.result = r;
      this.setStatus('result');
      this.handlers?.onResult(r);
    });
    room.onMessage(Opcode.OpponentStatus, (bytes: Uint8Array) => {
      const { kind } = opponentStatusKind(bytes);
      this.statusQueue.push(kind);
    });
    room.onError((_code, message) => {
      this.lastError = String(message);
      this.handlers?.onError(this.lastError);
    });
    room.onLeave(() => this.stop(true));

    this.startLoops();
  }

  private startLoops(): void {
    this.stopLoops();
    // Отправка входов на частоте симуляции (60 Гц) с монотонным seq.
    this.inputTimer = setInterval(() => {
      this.room?.sendBytes(Opcode.InputFrame, packInputFrame(this.seq, this.inputWord));
      this.seq = (this.seq + 1) & 0xffff;
    }, Math.round(1000 / INPUT_HZ));
    // Локальное предсказание тем же шагом.
    this.predictTimer = setInterval(() => this.predictStep(), Math.round(1000 / SIM_HZ));
  }

  private predictStep(): void {
    const world = this.local;
    if (!world || !this.handlers) return;
    if (this.status !== 'fight') {
      // Ожидание боя: мир не крутим, пока не начнутся авторитетные тики.
      return;
    }
    const meWord = this.inputWord;
    stepWorld(world, [meWord, this.oppWord], [this.mePrev, this.oppPrev]);
    this.mePrev = meWord;
    this.oppPrev = this.oppWord;
    this.history.push({ tick: world.tick, word: meWord });
    if (this.history.length > this.MAX_REPLAY * 4) {
      this.history.splice(0, this.history.length - this.MAX_REPLAY * 4);
    }
    this.handlers.onTick(world, this.mySide);
  }

  private onSnapshot(auth: FightWorld): void {
    if (!this.local) {
      // Первый снапшот — точка синхронизации мира.
      this.local = cloneWorld(auth);
      this.mePrev = 0;
      this.oppPrev = 0;
      this.history = [];
      this.setStatus('fight');
      return;
    }
    const from = auth.tick;
    const ahead = this.local.tick - from;
    if (ahead < 0) {
      // Сервер нас обогнал (потерянные в сети кадры) — просто пересинхронизируем.
      this.local = cloneWorld(auth);
      this.mePrev = 0;
      this.oppPrev = 0;
      this.history = [];
      return;
    }
    // Rollback: авторитетное состояние + повтор наших локальных входов.
    this.local = cloneWorld(auth);
    const replay = this.history.filter((h) => h.tick > from).slice(0, this.MAX_REPLAY);
    let basePrev = this.mePrev;
    for (const h of replay) {
      stepWorld(this.local, [h.word, this.oppWord], [basePrev, this.oppPrev]);
      basePrev = h.word;
    }
    // История старше авторитетного якоря больше не нужна.
    const cut = this.history.findIndex((h) => h.tick > from);
    this.history = cut >= 0 ? this.history.slice(cut) : [];
    this.setStatus('fight');
  }

  async leave(): Promise<void> {
    try {
      await this.room?.leave();
    } catch {
      /* не критично */
    }
    this.stop(true);
  }

  private stop(notify: boolean): void {
    this.stopLoops();
    if (this.room) {
      try {
        this.room = null;
      } catch {
        /* нет-нет */
      }
    }
    if (this.client) {
      this.client = null;
    }
    if (notify) this.handlers?.onLeave();
  }

  private stopLoops(): void {
    if (this.inputTimer) {
      clearInterval(this.inputTimer);
      this.inputTimer = null;
    }
    if (this.predictTimer) {
      clearInterval(this.predictTimer);
      this.predictTimer = null;
    }
  }
}