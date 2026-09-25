/**
 * Roundtrip бинарного протокола (pack/unpack) и границы полей.
 */
import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  packWorld,
  unpackWorld,
  packInputFrame,
  decodeInputMessage,
  packEvent,
  unpackEvent,
  packMatchResult,
  unpackMatchResult,
  packOpponentStatus,
  opponentStatusKind,
} from '@sf/shared';

describe('packWorld/unpackWorld', () => {
  it('сохраняет весь боевой мир без потерь', () => {
    const w = createWorld(42);
    for (let i = 0; i < 120; i++) stepWorld(w, [64 | 16, 0], [0, 0]);
    w.fighters[0].hp = 72.4;
    w.fighters[1].st = 'crouch';

    const round = unpackWorld(packWorld(w));
    expect(round.tick).toBe(w.tick);
    expect(round.seed).toBe(w.seed);
    expect(round.phase).toBe(w.phase);
    expect(round.phaseT).toBe(w.phaseT);
    expect(round.round).toBe(w.round);
    expect(round.wins).toEqual(w.wins);
    expect(round.roundTimer).toBe(w.roundTimer);

    const [a, b] = [round.fighters[0], round.fighters[1]];
    expect(a.side).toBe(0);
    expect(b.side).toBe(1);
    expect(a.x).toBeCloseTo(w.fighters[0].x, 0.01);
    expect(a.h).toBeCloseTo(w.fighters[0].h, 0.01);
    expect(a.hp).toBe(72);
    expect(a.stamina).toBe(w.fighters[0].stamina);
    expect(a.facing).toBe(w.fighters[0].facing);
    expect(a.st).toBe(w.fighters[0].st);
    expect(a.attack).toEqual({ type: null, frame: 0, hits: 0 });
    expect(b.st).toBe('crouch');
  });

  it('сохраняет активную атаку', () => {
    const w = createWorld();
    stepWorld(w, [16, 0], [0, 0]);
    stepWorld(w, [0, 0], [16, 0]);
    w.fighters[0].st = 'attack';
    w.fighters[0].attack = { type: 'punch', frame: 2, hits: 0 };
    const round = unpackWorld(packWorld(w));
    expect(round.fighters[0].attack).toEqual({ type: 'punch', frame: 2, hits: 0 });
    expect(round.fighters[0].st).toBe('attack');
  });

  it('между разными снапшотами размер байтового буфера стабилен', () => {
    const a = createWorld();
    const b = createWorld();
    expect(packWorld(a).byteLength).toBe(packWorld(b).byteLength);
  });
});

describe('потоковые сообщения', () => {
  it('packInputFrame/decodeInputMessage: seq и word по местам', () => {
    const buf = packInputFrame(0xabcd, 0x1234);
    expect(buf.byteLength).toBe(4);
    expect(decodeInputMessage(buf)).toEqual({ seq: 0xabcd, word: 0x1234 });
  });

  it('packEvent/unpackEvent: roundtrip события фазы', () => {
    const ev = { type: 'ko', loser: 1 } as const;
    expect(unpackEvent(packEvent(ev))).toEqual(ev);
    const hit = { type: 'hit', target: 0, dmg: 7, hp: 55, x: 123.5, h: 0.25 } as const;
    expect(unpackEvent(packEvent(hit))).toEqual(hit);
  });

  it('packMatchResult/unpackMatchResult', () => {
    const buf = packMatchResult(1, [0, 2]);
    expect(buf.byteLength).toBe(3);
    expect(unpackMatchResult(buf)).toEqual({ winner: 1, wins: [0, 2] });
  });

  it('packOpponentStatus + opponentStatusKind', () => {
    const dq = packOpponentStatus('dq', 1200);
    expect(opponentStatusKind(dq)).toEqual({ kind: 'dq', t: 1200 });

    const rec = packOpponentStatus('reconnect', 5);
    expect(opponentStatusKind(rec)).toEqual({ kind: 'reconnect', t: 5 });

    const p = packOpponentStatus('pause');
    expect(opponentStatusKind(p)).toEqual({ kind: 'pause', t: 0 });
  });
});