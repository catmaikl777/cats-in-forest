/**
 * Детерминированный боевой движок.
 *
 * Один вызов `stepWorld` = один тик симуляции (60 Гц). Функция PURE-по-смыслу:
 * одинаковый ввод из одинакового состояния даёт одинаковый результат — именно
 * поэтому клиент может реплеить симуляцию локально (predict + rollback), а
 * сервер остаётся авторитетом.
 *
 * Соглашения:
 *  - x — слева направо по арене [40, ARENA_W-40]; h — высота ног над полом;
 *  - слова ввода см. net/input.ts (edges кнопок выводятся из разницы с prev);
 *  - события фазы (countdown/fight/hit/ko/roundend/matchend) возвращаются как
 *    массив за тик.
 */
import { MAX_PLAYERS, ROUNDS_TO_WIN, Side } from '../types';
import { ButtonBit, DirBit } from '../net/input';
import {
  MAX_HP,
  MAX_STAMINA,
  WALK_SPEED,
  GROUND_ACCEL,
  GROUND_FRICTION,
  AIR_ACCEL,
  GRAVITY,
  JUMP_VY,
  MAX_FALL,
  DASH_VX,
  DASH_COOLDOWN,
  DASH_STAMINA_COST,
  STAMINA_REGEN,
  FIGHTER_HALF_W,
  HURTBOX_STANDING,
  HURTBOX_CROUCH,
  ATTACK_ORIGIN,
  COUNTDOWN_FRAMES,
  ROUND_END_FRAMES,
  roundTimerFrames,
  MOVES,
} from './constants';
import type { FighterState, FightWorld, FightEvent } from './types';

void MAX_PLAYERS;

export const SIDE0_X = 700;
export const SIDE1_X = 1700;

export function createWorld(seed = 1): FightWorld {
  return {
    tick: 0,
    seed,
    fighters: [newFighter(0, SIDE0_X), newFighter(1, SIDE1_X)],
    phase: 'countdown',
    phaseT: 0,
    round: 0,
    wins: [0, 0],
    roundTimer: 0,
    lastWinner: null,
  };
}

function newFighter(side: Side, x: number): FighterState {
  return {
    side,
    x,
    h: 0,
    vx: 0,
    vy: 0,
    facing: side === 0 ? 1 : -1,
    hp: MAX_HP,
    stamina: MAX_STAMINA,
    grounded: true,
    st: 'idle',
    stT: 0,
    attack: { type: null, frame: 0, hits: 0 },
    hitstun: 0,
    dashCd: 0,
    down: false,
  };
}

/** Глубокая копия мира (для rollback на клиенте). */
export function cloneWorld(world: FightWorld): FightWorld {
  const cloneF = (f: FighterState): FighterState => ({
    ...f,
    attack: { ...f.attack },
  });
  const [a, b] = world.fighters;
  return {
    ...world,
    wins: [...world.wins],
    fighters: [cloneF(a), cloneF(b)],
  };
}

/** Баннер обратного отсчёта (3/2/1; 0 — уже начался бой). */
export function countdownNumber(phaseT: number): number {
  if (phaseT < 50) return 3;
  if (phaseT < 100) return 2;
  if (phaseT < 150) return 1;
  return 0;
}

/** Один тик симуляции. Мутирует world, возвращает события тика. */
export function stepWorld(
  world: FightWorld,
  inputs: readonly [number, number],
  prevInputs: readonly [number, number] = inputs,
): FightEvent[] {
  const events: FightEvent[] = [];
  world.tick += 1;
  const [a, b] = world.fighters;

  switch (world.phase) {
    case 'matchend':
      return events;

    case 'roundend': {
      world.phaseT += 1;
      if (world.phaseT < ROUND_END_FRAMES) return events;
      const [wa, wb] = world.wins;
      if (wa >= ROUNDS_TO_WIN || wb >= ROUNDS_TO_WIN) {
        world.phase = 'matchend';
        world.phaseT = 0;
        events.push({ type: 'matchend', winner: wa > wb ? 0 : 1, wins: [wa, wb] });
        return events;
      }
      resetRound(world);
      world.phase = 'countdown';
      world.phaseT = 0;
      events.push({ type: 'countdown', n: 3 });
      return events;
    }

    case 'countdown': {
      world.phaseT += 1;
      if (world.phaseT >= COUNTDOWN_FRAMES) {
        world.phase = 'fight';
        world.phaseT = 0;
        world.roundTimer = roundTimerFrames();
        events.push({ type: 'fight' });
        return events;
      }
      const cur = countdownNumber(world.phaseT);
      const prev = countdownNumber(world.phaseT - 1);
      if (cur !== prev) events.push({ type: 'countdown', n: cur });
      return events;
    }

    case 'fight': {
      world.phaseT += 1;
      world.roundTimer -= 1;

      updateFighter(world, a, b, inputs[0] ?? 0, prevInputs[0] ?? 0);
      updateFighter(world, b, a, inputs[1] ?? 0, prevInputs[1] ?? 0);

      resolveContact(a, b);

      resolveAttack(world, a, b, events);
      resolveAttack(world, b, a, events);

      if (world.phase !== 'fight') return events;

      if (a.hp <= 0 || b.hp <= 0) {
        const loser: Side = a.hp <= 0 ? 0 : 1;
        const winner: Side = loser === 0 ? 1 : 0;
        events.push({ type: 'ko', loser });
        world.wins[winner] += 1;
        world.lastWinner = winner;
        world.phase = 'roundend';
        world.phaseT = 0;
        events.push({
          type: 'roundend',
          winner,
          reason: 'ko',
          wins: [world.wins[0], world.wins[1]],
        });
      } else if (world.roundTimer <= 0) {
        const winner: Side | null = a.hp > b.hp ? 0 : a.hp < b.hp ? 1 : null;
        if (winner !== null) world.wins[winner] += 1;
        world.lastWinner = winner;
        world.phase = 'roundend';
        world.phaseT = 0;
        events.push({
          type: 'roundend',
          winner,
          reason: 'time',
          wins: [world.wins[0], world.wins[1]],
        });
      }
      return events;
    }
  }
}

function resetRound(world: FightWorld): void {
  world.round += 1;
  const [a, b] = world.fighters;
  for (const f of world.fighters) {
    f.x = f.side === 0 ? SIDE0_X : SIDE1_X;
    f.h = 0;
    f.vx = 0;
    f.vy = 0;
    f.hp = MAX_HP;
    f.stamina = MAX_STAMINA;
    f.grounded = true;
    f.st = 'idle';
    f.stT = 0;
    f.attack = { type: null, frame: 0, hits: 0 };
    f.hitstun = 0;
    f.dashCd = 0;
    f.down = false;
    f.facing = a.x >= b.x ? (f.side === 0 ? -1 : 1) : f.side === 0 ? 1 : -1;
  }
  world.phaseT = 0;
}

function dirsOf(word: number): { l: boolean; r: boolean; u: boolean; d: boolean } {
  const r = (word & DirBit.E) !== 0 || (word & DirBit.NE) !== 0 || (word & DirBit.SE) !== 0;
  const l = (word & DirBit.W) !== 0 || (word & DirBit.NW) !== 0 || (word & DirBit.SW) !== 0;
  const u = (word & DirBit.N) !== 0 || (word & DirBit.NE) !== 0 || (word & DirBit.NW) !== 0;
  const d = (word & DirBit.S) !== 0 || (word & DirBit.SW) !== 0 || (word & DirBit.SE) !== 0;
  return { l: l && !r, r: r && !l, u: u && !d, d: d && !u };
}

function approach(v: number, target: number, step: number): number {
  if (target > v) return Math.min(v + step, target);
  if (target < v) return Math.max(v - step, target);
  return v;
}

function updateFighter(
  _world: FightWorld,
  f: FighterState,
  opp: FighterState,
  word: number,
  prev: number,
): void {
  f.stT += 1;
  if (f.dashCd > 0) f.dashCd -= 1;
  if (f.stamina < MAX_STAMINA) f.stamina = Math.min(MAX_STAMINA, f.stamina + STAMINA_REGEN);
  f.facing = (opp.x > f.x ? 1 : -1) as 1 | -1;

  const pressed = word & ~prev;
  const d = dirsOf(word);
  const punchEdge = (pressed & ButtonBit.PUNCH) !== 0;
  const kickEdge = (pressed & ButtonBit.KICK) !== 0;
  const dashEdge = (pressed & ButtonBit.DASH) !== 0;

  // 1) Набегающие таймеры.
  if (f.st === 'hitstun') {
    f.hitstun -= 1;
    if (f.hitstun <= 0) f.st = 'idle';
  } else if (f.st === 'attack' && f.attack.type) {
    const mv = MOVES[f.attack.type];
    f.attack.frame += 1;
    if (f.attack.frame >= mv.startup + mv.active + mv.recovery) {
      f.attack = { type: null, frame: 0, hits: 0 };
      f.st = f.grounded ? 'idle' : 'jump';
    }
  }

  const busy =
    f.st === 'attack' || f.st === 'hitstun' || f.st === 'ko' || f.down || f.dashCd > 0;

  // 2) Прыжок (edge вверх) — только с земли и когда свободен.
  if (!busy && f.grounded && d.u) {
    f.vy = JUMP_VY;
    f.grounded = false;
    f.st = 'jump';
  }

  // 3) Рывок (edge) — в сторону желаемого движения, иначе к сопернику.
  if (!busy && f.grounded && dashEdge && f.stamina >= DASH_STAMINA_COST) {
    const dir = d.l ? -1 : d.r ? 1 : f.facing;
    f.vx = dir * DASH_VX;
    f.stamina -= DASH_STAMINA_COST;
    f.dashCd = DASH_COOLDOWN;
    f.grounded = true;
    if (f.st === 'walk' || f.st === 'idle' || f.st === 'crouch') {
      // рывок сам по себе состояние не меняет
    }
  }

  // 4) Старт атаки (edge) — только на земле и когда свободен.
  if (!busy && f.grounded && (punchEdge || kickEdge)) {
    const type = punchEdge ? 'punch' : 'kick';
    f.st = 'attack';
    f.attack = { type, frame: 0, hits: 0 };
    f.vx = f.facing * MOVES[type].lunge;
  }

  const locked =
    f.st === 'attack' || f.st === 'hitstun' || f.st === 'ko' || f.down || f.dashCd > 0;

  // 5) Горизонтальное управление.
  const wanting = (d.r ? 1 : 0) - (d.l ? 1 : 0);
  if (!locked && f.st !== 'attack') {
    const crouch = f.grounded && d.d && wanting === 0;
    const target = crouch ? 0 : wanting * WALK_SPEED;
    f.vx = approach(f.vx, target, f.grounded ? GROUND_ACCEL : AIR_ACCEL);
  } else {
    f.vx *= GROUND_FRICTION;
  }

  // 6) Вертикаль. vy > 0 — вверх; гравитация тянет вниз.
  if (!f.grounded) {
    f.vy = Math.max(f.vy - GRAVITY, -MAX_FALL);
    f.h += f.vy;
    if (f.h <= 0 && f.vy <= 0) {
      f.h = 0;
      f.vy = 0;
      f.grounded = true;
      if (f.st !== 'hitstun' && f.st !== 'ko') f.st = 'idle';
    }
  } else if (f.st !== 'attack' && f.st !== 'hitstun' && f.st !== 'ko') {
    if (d.d) f.st = 'crouch';
    else if (d.l || d.r) f.st = 'walk';
    else f.st = 'idle';
  } else if (!f.grounded && f.st !== 'attack' && f.st !== 'hitstun' && f.st !== 'ko') {
    f.st = 'jump';
  }

  // 7) Границы арены.
  if (f.x < 40) {
    f.x = 40;
    f.vx = Math.max(0, f.vx);
  } else if (f.x > 2360) {
    f.x = 2360;
    f.vx = Math.min(0, f.vx);
  }
  f.x += f.vx;
}

function resolveContact(f0: FighterState, f1: FighterState): void {
  const gap = Math.abs(f1.x - f0.x);
  const need = FIGHTER_HALF_W * 2;
  if (gap >= need) return;
  const push = (need - gap) / 2;
  if (f0.x <= f1.x) {
    f0.x = Math.max(40, f0.x - push);
    f1.x = Math.min(2360, f1.x + push);
  } else {
    f0.x = Math.min(2360, f0.x + push);
    f1.x = Math.max(40, f1.x - push);
  }
}

function resolveAttack(
  _world: FightWorld,
  f: FighterState,
  opp: FighterState,
  events: FightEvent[],
): void {
  const atk = f.attack;
  if (!atk.type || atk.hits > 0) return;
  const mv = MOVES[atk.type];
  const active = atk.frame >= mv.startup && atk.frame < mv.startup + mv.active;
  if (!active) return;
  if (opp.st === 'ko' && opp.down) return;

  // X-пересечение.
  const atkX0 = f.x + f.facing * ATTACK_ORIGIN;
  const atkX1 = f.x + f.facing * (ATTACK_ORIGIN + mv.range);
  const bx0 = opp.x - FIGHTER_HALF_W;
  const bx1 = opp.x + FIGHTER_HALF_W;
  if (Math.min(atkX1, bx1) < Math.max(atkX0, bx0)) return;

  // Высотная полоса.
  const hurt = opp.grounded && opp.st === 'crouch' ? HURTBOX_CROUCH : HURTBOX_STANDING;
  const aTop = f.h + mv.top;
  const aBot = f.h + mv.bottom;
  const tTop = opp.h + hurt.top;
  const tBot = opp.h + hurt.bottom;
  if (aBot > tTop || aTop < tBot) return;

  opp.hp -= mv.dmg;
  atk.hits = 1;
  events.push({
    type: 'hit',
    target: opp.side,
    dmg: mv.dmg,
    hp: Math.max(0, opp.hp),
    x: opp.x,
    h: opp.h,
  });

  if (opp.hp <= 0) {
    opp.hp = 0;
    opp.st = 'ko';
    opp.down = true;
    opp.hitstun = 0;
    opp.grounded = false;
    opp.vy = 6;
    opp.vx = f.facing * mv.knockdown * 1.5;
  } else {
    opp.st = 'hitstun';
    opp.hitstun = mv.hitstun;
    opp.vx = f.facing * mv.knockdown;
  }
}