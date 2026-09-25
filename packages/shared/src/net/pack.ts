/**
 * Бинарное кодирование боевого трафика (снапшоты 20 Гц, ввод, события).
 *
 * Соглашение о сообщениях: тип сообщения (сигнатура Colyseus) = Opcode,
 * payload = только поля без опкода (экономия байта на пакет и чистая
 * маршрутизация `onMessage(Opcode.X, cb)`).
 *
 * Формат полей — little-endian. Позиции: x — px по арене, h — высота ног над
 * полом. float32 одинаково интерпретируется V8 на обеих сторонах; снапшот —
 * авторитетный источник (роллбэк на клиенте опирается на инты и enum).
 */
import type { FighterState, FightWorld, FightEvent, MatchPhaseSim } from '../sim/types';
import type { Side } from '../types';

const PhC = 0, PhF = 1, PhRE = 2, PhME = 3;
const StIdle = 0, StWalk = 1, StCrouch = 2, StJump = 3, StAttack = 4, StHitstun = 5, StKo = 6;
const AtkNone = 0, AtkPunch = 1, AtkKick = 2;

const PHASE_TO_IDX: Record<MatchPhaseSim, number> = {
  countdown: PhC,
  fight: PhF,
  roundend: PhRE,
  matchend: PhME,
};
const IDX_TO_PHASE: MatchPhaseSim[] = ['countdown', 'fight', 'roundend', 'matchend'];

const ST_TO_IDX: Record<FighterState['st'], number> = {
  idle: StIdle,
  walk: StWalk,
  crouch: StCrouch,
  jump: StJump,
  attack: StAttack,
  hitstun: StHitstun,
  ko: StKo,
};
const IDX_TO_ST: FighterState['st'][] = ['idle', 'walk', 'crouch', 'jump', 'attack', 'hitstun', 'ko'];

const SIZE = 4 + 4 + 1 + 2 + 1 + 1 + 1 + 2 + 2 * 30; // мир + 2 бойца по 30 байт

/** Пишет полный снапшот мира (payload без опкода). */
export function packWorld(w: FightWorld): Uint8Array {
  const buf = new Uint8Array(SIZE);
  const v = new DataView(buf.buffer);
  let o = 0;
  v.setUint32(o, w.tick, true); o += 4;
  v.setFloat32(o, w.seed, true); o += 4;
  buf[o++] = PHASE_TO_IDX[w.phase];
  v.setUint16(o, w.phaseT, true); o += 2;
  buf[o++] = w.round;
  buf[o++] = w.wins[0];
  buf[o++] = w.wins[1];
  v.setUint16(o, w.roundTimer, true); o += 2;
  for (const f of w.fighters) { o = packFighter(buf, v, o, f); }
  return buf;
}

function packFighter(buf: Uint8Array, v: DataView, o: number, f: FighterState): number {
  v.setFloat32(o, f.x, true); o += 4;
  v.setFloat32(o, f.h, true); o += 4;
  v.setFloat32(o, f.vx, true); o += 4;
  v.setFloat32(o, f.vy, true); o += 4;
  buf[o++] = Math.max(0, Math.min(255, Math.round(f.hp)));
  buf[o++] = Math.max(0, Math.min(255, Math.round(f.stamina)));
  buf[o++] = f.facing === 1 ? 1 : 0;
  buf[o++] = ST_TO_IDX[f.st];
  v.setUint16(o, f.stT, true); o += 2;
  buf[o++] = f.attack.type === null ? AtkNone : f.attack.type === 'punch' ? AtkPunch : AtkKick;
  v.setUint16(o, f.attack.frame, true); o += 2;
  buf[o++] = f.attack.hits;
  buf[o++] = f.hitstun;
  buf[o++] = f.dashCd;
  buf[o++] = f.down ? 1 : 0;
  buf[o++] = f.grounded ? 1 : 0;
  return o;
}

/** Читает снапшот мира из байтов. */
export function unpackWorld(buf: Uint8Array, offset = 0): FightWorld {
  const v = new DataView(buf.buffer, buf.byteOffset + offset);
  let o = 0;
  const tick = v.getUint32(o, true); o += 4;
  const seed = v.getFloat32(o, true); o += 4;
  const phase = IDX_TO_PHASE[buf[offset + o] ?? 0] ?? 'countdown';
  o += 1;
  const phaseT = v.getUint16(o, true); o += 2;
  const round = buf[offset + o] ?? 0; o += 1;
  const wins: [number, number] = [buf[offset + o] ?? 0, buf[offset + o + 1] ?? 0];
  o += 2;
  const roundTimer = v.getUint16(o, true); o += 2;
  const p0 = unpackFighter(buf, v, offset, o, 0);
  const p1 = unpackFighter(buf, v, offset, o + 30, 1);
  return { tick, seed, phase, phaseT, round, wins, roundTimer, fighters: [p0, p1], lastWinner: null };
}

function unpackFighter(buf: Uint8Array, v: DataView, base: number, o: number, side: Side): FighterState {
  const x = v.getFloat32(o, true); o += 4;
  const h = v.getFloat32(o, true); o += 4;
  const vx = v.getFloat32(o, true); o += 4;
  const vy = v.getFloat32(o, true); o += 4;
  const hp = buf[base + o] ?? 0; o += 1;
  const stamina = buf[base + o] ?? 0; o += 1;
  const facing = (buf[base + o] ?? 0) === 1 ? 1 : -1; o += 1;
  const st = IDX_TO_ST[buf[base + o] ?? 0] ?? 'idle'; o += 1;
  const stT = v.getUint16(o, true); o += 2;
  const atkIdx = buf[base + o] ?? 0; o += 1;
  const atkFrame = v.getUint16(o, true); o += 2;
  const atkHits = buf[base + o] ?? 0; o += 1;
  const hitstun = buf[base + o] ?? 0; o += 1;
  const dashCd = buf[base + o] ?? 0; o += 1;
  const down = (buf[base + o] ?? 0) === 1; o += 1;
  const grounded = (buf[base + o] ?? 0) === 1; o += 1;
  return {
    side,
    x, h, vx, vy,
    facing: facing as 1 | -1,
    hp, stamina,
    grounded,
    st,
    stT,
    attack: { type: atkIdx === 0 ? null : atkIdx === 1 ? 'punch' : 'kick', frame: atkFrame, hits: atkHits },
    hitstun, dashCd, down,
  };
}

/** Сообщение ввода: seq(2) + word(2), payload без опкода. */
export function packInputFrame(seq: number, word: number): Uint8Array {
  const buf = new Uint8Array(4);
  const v = new DataView(buf.buffer);
  v.setUint16(0, seq & 0xffff, true);
  v.setUint16(2, word & 0xffff, true);
  return buf;
}

/** Декодирует входящий фрейм ввода клиента. */
export function decodeInputMessage(buf: Uint8Array, offset = 0): { seq: number; word: number } {
  const v = new DataView(buf.buffer, buf.byteOffset + offset);
  return { seq: v.getUint16(0, true), word: v.getUint16(2, true) };
}

/** Событие фазы (RoundEvent): json-тело, редкие события, компактность не критична. */
export function packEvent(ev: FightEvent): Uint8Array {
  return utf8Encode(JSON.stringify(ev));
}

/** Читает событие фазы из байтов. */
export function unpackEvent(buf: Uint8Array, offset = 0): FightEvent {
  return JSON.parse(utf8Decode(buf, offset)) as FightEvent;
}

/** Итог матча (MatchResult): winner(1) + wins0(1) + wins1(1). */
export function packMatchResult(winner: Side, wins: [number, number]): Uint8Array {
  return new Uint8Array([winner, wins[0], wins[1]]);
}

export function unpackMatchResult(buf: Uint8Array, offset = 0): { winner: Side; wins: [number, number] } {
  return {
    winner: (buf[offset] ?? 0) as Side,
    wins: [buf[offset + 1] ?? 0, buf[offset + 2] ?? 0],
  };
}

/** Статус соперника (OpponentStatus): kind(1) + t(2). */
export function packOpponentStatus(kind: 'dq' | 'reconnect' | 'pause', t = 0): Uint8Array {
  const k = kind === 'dq' ? 0 : kind === 'reconnect' ? 1 : 2;
  const buf = new Uint8Array(3);
  const v = new DataView(buf.buffer);
  buf[0] = k;
  v.setUint16(1, t & 0xffff, true);
  return buf;
}

export function opponentStatusKind(buf: Uint8Array, offset = 0): { kind: 'dq' | 'reconnect' | 'pause'; t: number } {
  const k = buf[offset] ?? 0;
  const v = new DataView(buf.buffer, buf.byteOffset + offset);
  const t = v.getUint16(1, true);
  const kind = k === 0 ? 'dq' : k === 1 ? 'reconnect' : 'pause';
  return { kind, t };
}

function utf8Encode(s: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return Uint8Array.from(bytes);
}

function utf8Decode(buf: Uint8Array, offset: number): string {
  let s = '';
  let i = offset;
  while (i < buf.length) {
    const b = buf[i] ?? 0;
    i += 1;
    if (b < 0x80) {
      s += String.fromCharCode(b);
    } else if (b < 0xe0) {
      s += String.fromCharCode(((b & 0x1f) << 6) | ((buf[i] ?? 0) & 0x3f));
      i += 1;
    } else {
      s += String.fromCharCode(
        ((b & 0x0f) << 12) | (((buf[i] ?? 0) & 0x3f) << 6) | ((buf[i + 1] ?? 0) & 0x3f),
      );
      i += 2;
    }
  }
  return s;
}