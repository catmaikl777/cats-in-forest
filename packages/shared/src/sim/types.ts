/**
 * Типы боевой симуляции (детерминированный движок, общий для обеих сторон).
 *
 * ВСЁ, что здесь, обязано быть СЕРИАЛИЗУЕМО в бинарный снапшот и обратно —
 * см. net/pack.ts. Никаких функций в состоянии.
 */
import type { Side } from '../types';
import type { AttackType } from './constants';

/** Текущее «действие» бойца (для анимаций/роутинга механики). */
export type FighterSt = 'idle' | 'walk' | 'crouch' | 'jump' | 'attack' | 'hitstun' | 'ko';

/** Неизменяемое состояние бойца. h — высота ног над полом. */
export interface FighterState {
  side: Side;
  x: number;
  h: number;
  vx: number;
  vy: number;
  /** 1 — смотрит вправо (+x), -1 — влево. */
  facing: 1 | -1;
  hp: number;
  stamina: number;
  grounded: boolean;
  st: FighterSt;
  /** Кадры, проведённые в текущем состоянии (для строк анимаций). */
  stT: number;
  /** Активная атака (null — не атакует). */
  attack: {
    type: AttackType | null;
    /** Кадр внутри атаки (0=начала стартапа). */
    frame: number;
    /** Счётчик попаданий за один активный период (1 удар на атаку). */
    hits: number;
  };
  /** Оставшийся хитстан, кадры. */
  hitstun: number;
  /** Кулдаун рывка после использования, кадры. */
  dashCd: number;
  /** Признак «лежит в нокауте» (для рендера). */
  down: boolean;
}

/** Фаза матча, видимая обеим сторонам. */
export type MatchPhaseSim = 'countdown' | 'fight' | 'roundend' | 'matchend';

/** Полное состояние матча (два бойца + динамика раундов). */
export interface FightWorld {
  tick: number;
  /** Детерминированный сид (пока не используется, но входит в снапшоты). */
  seed: number;
  fighters: [FighterState, FighterState];
  phase: MatchPhaseSim;
  /** Кадр внутри текущей фазы. */
  phaseT: number;
  /** Номер раунда, 0-based. */
  round: number;
  wins: [number, number];
  /** Остаток таймера раунда, кадры (60/с). */
  roundTimer: number;
  lastWinner: Side | null;
}

/** Событие фазы, которое сервер рассылает и которое рендерит клиент. */
export type FightEventType =
  | 'countdown'
  | 'fight'
  | 'hit'
  | 'ko'
  | 'roundend'
  | 'matchend';

export type FightEvent =
  | { type: 'countdown'; n: number }
  | { type: 'fight' }
  | { type: 'hit'; target: Side; dmg: number; hp: number; x: number; h: number }
  | { type: 'ko'; loser: Side }
  | { type: 'roundend'; winner: Side | null; reason: 'ko' | 'time'; wins: [number, number] }
  | { type: 'matchend'; winner: Side; wins: [number, number] };