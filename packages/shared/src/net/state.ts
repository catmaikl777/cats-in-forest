/**
 * Состояния комнат, передаваемые по каналу Colyseus (schema-сериализация).
 *
 * БОЕВЫЕ состояния (снапшоты бойцов) НЕ используют schema: они идут через
 * собственный бинарный протокол (protocol.ts -> pack.ts). Schema применяется
 * только к «структурным» комнатным состояниям (lobby/heartbeat), которые
 * меняются редко и выигрывают от дельта-патчей Colyseus.
 *
 * ВАЖНО: builder-API v5 — `schema()` + `t.*()` с круглыми скобками.
 * deprecated `defineTypes()` в @colyseus/schema 5.0.34 не рассылает
 * дельта-патчи клиентам, а `t.number` без скобок — это getter-фабрика
 * (и поля превращаются в функции).
 */
import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Состояние heartbeat-комнаты (этап 2): проверка канала клиент<->сервер.
 * Значения: players (в комнате), serverTime (тикает раз в секунду),
 * version (версия протокола).
 */
export const HeartbeatState = schema(
  {
    players: t.number(),
    serverTime: t.number(),
    version: t.number(),
  },
  'HeartbeatState',
);
export type HeartbeatState = SchemaType<typeof HeartbeatState>;

/**
 * Состояние боевой комнаты — «обложка» для лобби/наблюдения. Сам бой идёт по
 * бинарному протоколу (см. protocol.ts/pack.ts); schema здесь несёт только
 * смену фазы/раунда, чтобы клиент и мониторинг видели прогресс без парсинга
 * снапшотов. phase: 0=countdown, 1=fight, 2=roundend, 3=matchend.
 */
export const FightRoomState = schema(
  {
    phase: t.number(),
    round: t.number(),
    players: t.number(),
    result: t.number(),
  },
  'FightRoomState',
);
export type FightRoomState = SchemaType<typeof FightRoomState>;