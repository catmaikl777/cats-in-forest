/**
 * 16-битный «фрейм ввода» — атом обмена между клиентом и сервером.
 *
 * Управление клона SF2: виртуальный джойстик с 8 направлениями + 2 кнопки
 * (рука/нога) + служебные флаги. Один фрейм = одно 16-битное слово, которое
 * клиент шлёт каждый симуляционный тик (60 Гц), а сервер передаёт в сим.
 *
 * Формат слова:
 *   bits 0..7  — направления (приложение позволяет одновременно держать несколько)
 *   bits 8..9  — кнопки руки/ноги (hold, пока зажато)
 *   bit  10    — edge-жест «рывок» (двойной тап / флик направления)
 *   bit  11    — подтверждение «готов» (подтверждение старта раунда)
 *   bits 12..15 — зарезервированы (например, смена оружия инвентаря)
 */

export const INPUT_FRAME_BYTES = 2;

export enum DirBit {
  E = 1 << 0,
  NE = 1 << 1,
  N = 1 << 2,
  NW = 1 << 3,
  W = 1 << 4,
  SW = 1 << 5,
  S = 1 << 6,
  SE = 1 << 7,
}

export enum ButtonBit {
  PUNCH = 1 << 8, // кнопка «рука»
  KICK = 1 << 9, // кнопка «нога»
  DASH = 1 << 10, // edge-жест «рывок»
  READY = 1 << 11, // подтверждение готовности к раунду
}

export const ALL_DIR_BITS =
  DirBit.E | DirBit.NE | DirBit.N | DirBit.NW | DirBit.W | DirBit.SW | DirBit.S | DirBit.SE;

/** Индекс октанта (0=E, 1=NE, 2=N, 3=NW, 4=W, 5=SW, 6=S, 7=SE) -> бит направления. */
const OCTANT_TO_BIT: readonly DirBit[] = [
  DirBit.E,
  DirBit.NE,
  DirBit.N,
  DirBit.NW,
  DirBit.W,
  DirBit.SW,
  DirBit.S,
  DirBit.SE,
];

/**
 * Преобразует нормализованный вектор джойстика в битмаску направления.
 * Соглашение координат: правая система, +x — вправо, +y — вверх
 * (экранный «вверх» = +y; слой UI уже инвертировал ось).
 */
export function directionBitsFromVector(x: number, y: number, deadzone = 0.35): number {
  const len = Math.hypot(x, y);
  if (len < deadzone) return 0;
  const nx = x / len;
  const ny = y / len;
  const octant = (Math.round(Math.atan2(ny, nx) / (Math.PI / 4)) + 8) & 7;
  return OCTANT_TO_BIT[octant] ?? 0;
}

/** Все 8 битов направления слова. */
export function dirBitsOf(bits: number): number {
  return bits & ALL_DIR_BITS;
}

/** Признак: в слове зажата хотя бы одна из переданных кнопок. */
export function hasAnyButton(bits: number, buttons: number): boolean {
  return (bits & buttons) !== 0;
}

export function hasButton(bits: number, button: ButtonBit): boolean {
  return (bits & button) !== 0;
}

export function hasDir(bits: number, dir: DirBit): boolean {
  return (bits & dir) !== 0;
}

/** Вернёт единственное направление слова (либо 0, если нажато несколько). */
export function primaryDir(bits: number): DirBit {
  const d = dirBitsOf(bits);
  switch (d) {
    case DirBit.E:
    case DirBit.NE:
    case DirBit.N:
    case DirBit.NW:
    case DirBit.W:
    case DirBit.SW:
    case DirBit.S:
    case DirBit.SE:
      return d as DirBit;
    default:
      return 0 as DirBit;
  }
}

/** Кодирует фрейм ввода в 2 байта начиная с offset. Возвращает число записанных байт. */
export function encodeInputFrame(bits: number, out: Uint8Array, offset = 0): number {
  out[offset] = bits & 0xff;
  out[offset + 1] = (bits >> 8) & 0xff;
  return INPUT_FRAME_BYTES;
}

/** Декодирует фрейм ввода из 2 байт начиная с offset. */
export function decodeInputFrame(src: Uint8Array, offset = 0): number {
  const lo = src[offset] ?? 0;
  const hi = src[offset + 1] ?? 0;
  return lo + (hi << 8);
}