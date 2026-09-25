/**
 * Тюнинг боевой симуляции. ВСЕ числа намеренно целочисленные/малые и должны
 * быть одинаковыми на клиенте и сервере — любое расхождение ломает
 * детерминизм (rollback на клиенте реплеит один и тот же код).
 *
 * Координаты: x — по арене слева направо [0, ARENA_W]; h — высота ног над
 * полом (0 = стоит на земле; при рендере Phaser: y = GROUND_Y - h).
 */

/** Стартовое HP бойца за раунд. */
export const MAX_HP = 100;
/** Стартовая шкала выносливости (рывки). */
export const MAX_STAMINA = 100;

/** Базовая скорость ходьбы, px/кадр. */
export const WALK_SPEED = 4;
/** Горизонтальное ускорение по земле (лёгкое сглаживание), px/кадр². */
export const GROUND_ACCEL = 0.9;
/** Торможение по земле при отпущенной клавише (множитель за кадр). */
export const GROUND_FRICTION = 0.72;
/** Горизонтальное управление в воздухе (слабее, чем на земле). */
export const AIR_ACCEL = 0.55;

/** Гравитация (вычитается из vy), px/кадр². */
export const GRAVITY = 0.45;
/** Импульс прыжка, px/кадр вверх. Высота ≈ vy²/(2·g) ≈ 147 px, ~51 кадр в воздухе. */
export const JUMP_VY = 11.5;
/** Предельная скорость падения (отрицательная). */
export const MAX_FALL = 16;

/** Импульс рывка вперёд/назад, px/кадр. */
export const DASH_VX = 14;
/** Длительность действия рывка (кадров), в течение которой не атакуем. */
export const DASH_COOLDOWN = 10;
/** Стоимость рывка в шкале выносливости. */
export const DASH_STAMINA_COST = 15;
/** Восстановление выносливости, ед./кадр (1.2/с). */
export const STAMINA_REGEN = 0.02;

/** Полуширина хитбокса тела, px. */
export const FIGHTER_HALF_W = 20;
/** Половина высоты тела при crouch. */
export const HURTBOX_STANDING = { top: 105, bottom: 25 } as const;
export const HURTBOX_CROUCH = { top: 50, bottom: 15 } as const;

/** Точка, из которой «бьют» относительно центра бойца. */
export const ATTACK_ORIGIN = 10;

/** Длительности фаз, кадров. */
export const COUNTDOWN_FRAMES = 150; // 2.5 с: 3-2-1-и-ПОШЛИ
export const ROUND_END_FRAMES = 120; // пауза после KO/таймаута, 2 с

/** Таймер раунда (кадры); ROUND_TIMER_S задан в types.ts. */
export function roundTimerFrames(): number {
  return 99 * 60;
}

/** Имена атак. */
export type AttackType = 'punch' | 'kick';

/** Определения атак: тайминги в кадрах, геометрия, урон. */
export interface MoveDef {
  startup: number;
  active: number;
  recovery: number;
  /** Дальность вытянутого удара от точки атаки, px. */
  range: number;
  /** Полоса высоты, которую бьёт удар (в h над полом). */
  top: number;
  bottom: number;
  /** Урон. */
  dmg: number;
  /** Импульс отбрасывания (в сторону атакующего). */
  knockdown: number;
  /** Хитстан у противника, кадры. */
  hitstun: number;
  /** Лёгкое продвижение вперёд в стартапе. */
  lunge: number;
}

export const MOVES: Record<AttackType, MoveDef> = {
  // Рука: быстрая, короткая, НЕ достаёт crouch (бьёт высоко).
  punch: {
    startup: 4,
    active: 3,
    recovery: 8,
    range: 60,
    top: 78,
    bottom: 55,
    dmg: 7,
    knockdown: 1.0,
    hitstun: 10,
    lunge: 1.2,
  },
  // Нога: медленнее, дальше, бьёт низко (достаёт crouch).
  kick: {
    startup: 6,
    active: 4,
    recovery: 12,
    range: 82,
    top: 78,
    bottom: 5,
    dmg: 12,
    knockdown: 2.0,
    hitstun: 14,
    lunge: 2,
  },
};