/**
 * Детерминизм и боевые сценарии сима (чистые функции, сеть не нужна).
 */
import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, cloneWorld, countdownNumber } from '@sf/shared';
import { ButtonBit, DirBit } from '@sf/shared';

const PUNCH = ButtonBit.PUNCH as number;
const KICK = ButtonBit.KICK as number;
const E = DirBit.E as number;
const S = DirBit.S as number;
const N = DirBit.N as number;

/** Промотать countdown (150 тиков) до боевой фазы. */
function enterFight(w = createWorld()) {
  for (let i = 0; i < 150; i++) stepWorld(w, [0, 0], [0, 0]);
  if (w.phase !== 'fight') throw new Error('not fight: ' + w.phase);
  return w;
}

describe('sim: детерминизм', () => {
  it('одинаковый ввод даёт идентичные состояния на каждом тике', () => {
    const a = createWorld(1);
    const b = createWorld(1);
    const inputs: [number, number] = [E, 0];
    for (let i = 0; i < 1800; i++) {
      stepWorld(a, inputs, inputs);
      stepWorld(b, inputs, inputs);
      expect(a.fighters[0]).toEqual(b.fighters[0]);
      expect(a.fighters[1]).toEqual(b.fighters[1]);
      expect(a.phase).toBe(b.phase);
      expect(a.tick).toBe(b.tick);
    }
  });

  it('cloneWorld изолирован от оригинала', () => {
    const w = createWorld(7);
    const c = cloneWorld(w);
    c.fighters[0].x = 999;
    c.wins[0] = 2;
    expect(w.fighters[0].x).not.toBe(999);
    expect(w.wins[0]).toBe(0);
  });
});

describe('sim: фазы матча', () => {
  it('countdown длится 150 тиков и переходит в fight', () => {
    const w = createWorld();
    expect(countdownNumber(0)).toBe(3);
    let fightTimer = -1;
    for (let i = 0; i < 200; i++) {
      stepWorld(w, [0, 0], [0, 0]);
      if (w.phase === 'fight' && fightTimer < 0) fightTimer = w.roundTimer;
    }
    expect(w.phase).toBe('fight');
    expect(fightTimer).toBe(99 * 60);
  });

  it('боец умеет ходить вправо и остановиться', () => {
    const w = createWorld();
    const none: [number, number] = [0, 0];
    const walk: [number, number] = [E, 0];
    const start = w.fighters[0].x;
    for (let i = 0; i < 300; i++) stepWorld(w, walk, none);
    expect(w.fighters[0].x).toBeGreaterThan(start);
    for (let i = 0; i < 300; i++) stepWorld(w, none, walk);
    expect(w.fighters[0].x).toBeLessThan(start + 300 * 4 + 100);
  });
});

describe('sim: удар и хитбоксы', () => {
  it('punch наносит ровно один хит за атаку и тратит HP', () => {
    const w = createWorld();
    w.fighters[0].x = 1000;
    w.fighters[1].x = 1060;
    w.fighters[0].facing = 1;
    w.fighters[1].facing = -1;
    enterFight(w);

    const hpBefore = w.fighters[1].hp;
    const atk: [number, number] = [PUNCH, 0];
    let prevAtk: [number, number] = [0, 0];
    let hits = 0;
    for (let i = 0; i < 120; i++) {
      const events = stepWorld(w, atk, prevAtk);
      prevAtk = atk;
      for (const ev of events) if (ev.type === 'hit') hits += 1;
    }
    expect(hits).toBe(1);
    expect(w.fighters[1].hp).toBe(hpBefore - 7);
  });

  it('punch пролетает мимо пригнувшегося соперника (присед ниже полосы)', () => {
    const w = createWorld();
    w.fighters[0].x = 1000;
    w.fighters[1].x = 1060;
    w.fighters[0].facing = 1;
    w.fighters[1].facing = -1;
    enterFight(w);

    const inputs: [number, number] = [PUNCH | E, S];
    const prev: [number, number] = [E, S];
    let hits = 0;
    for (let i = 0; i < 120; i++) {
      const events = stepWorld(w, inputs, prev);
      for (const ev of events) if (ev.type === 'hit') hits += 1;
    }
    expect(hits).toBe(0);
  });

  it('серия ударов добивает соперника до KO и завершает раунд', () => {
    const w = createWorld();
    w.fighters[0].x = 1000;
    w.fighters[1].x = 1060;
    w.fighters[0].facing = 1;
    w.fighters[1].facing = -1;
    enterFight(w);

    const atk: [number, number] = [PUNCH, 0];
    const prevAtk: [number, number] = [0, 0];
    let hits = 0;
    let ko = false;
    let roundEnded = false;
    for (let i = 0; i < 3600 && !roundEnded; i++) {
      const events = stepWorld(w, atk, prevAtk);
      for (const ev of events) {
        if (ev.type === 'hit') hits += 1;
        if (ev.type === 'ko') ko = true;
        if (ev.type === 'roundend') roundEnded = true;
      }
    }
    expect(hits).toBeGreaterThanOrEqual(14);
    expect(ko).toBe(true);
    expect(roundEnded).toBe(true);
    expect(w.wins[0]).toBe(1);
  });

  it('kick бьёт ниже: достаёт пригнувшегося', () => {
    const w = createWorld();
    w.fighters[0].x = 1000;
    w.fighters[1].x = 1080;
    w.fighters[0].facing = 1;
    w.fighters[1].facing = -1;
    enterFight(w);

    let cur: [number, number] = [KICK, S];
    let prv: [number, number] = [0, S];
    let hits = 0;
    for (let i = 0; i < 120; i++) {
      const events = stepWorld(w, cur, prv);
      prv = cur;
      for (const ev of events) if (ev.type === 'hit') hits += 1;
    }
    expect(hits).toBe(1);
    expect(w.fighters[1].hp).toBe(88);
  });
});

describe('sim: мелкие механики', () => {
  it('рывок тратит стамину и имеет кулдаун', () => {
    const w = enterFight();
    w.fighters[0].stamina = 100;
    const start = w.fighters[0].x;
    const dash: [number, number] = [E | ButtonBit.DASH, 0];
    const none: [number, number] = [0, 0];
    stepWorld(w, dash, none);
    expect(w.fighters[0].x).toBeGreaterThan(start);
    expect(w.fighters[0].stamina).toBeLessThan(100);
    expect(w.fighters[0].dashCd).toBeGreaterThan(0);
    // в кулдауне повторно не ускоряемся
    const x2 = w.fighters[0].x;
    stepWorld(w, dash, dash);
    stepWorld(w, dash, dash);
    expect(w.fighters[0].x - x2).toBeLessThan(30);
  });

  it('прыжок поднимает над полом и возвращает вниз', () => {
    const w = enterFight();
    const jump: [number, number] = [N, 0];
    const none: [number, number] = [0, 0];
    let maxH = 0;
    for (let i = 0; i < 240; i++) {
      stepWorld(w, jump, none);
      maxH = Math.max(maxH, w.fighters[0].h);
    }
    expect(maxH).toBeGreaterThan(100);
    // отпустили вверх — боец должен вернуться на землю
    for (let i = 0; i < 240; i++) stepWorld(w, none, jump);
    expect(w.fighters[0].h).toBe(0);
    expect(w.fighters[0].grounded).toBe(true);
  });
});