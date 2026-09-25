import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PROTO_VERSION } from '@sf/shared';
import { HeartbeatRoom } from './rooms/HeartbeatRoom';
import { FightRoom } from './rooms/FightRoom';
import { matchStore } from './store/JsonMatchStore';

export const DEFAULT_PORT = Number(process.env.PORT ?? 2567);

/**
 * Собирает HTTP-сервер + Colyseus 0.18.
 *
 * Колюзей держит собственный Express-совместимый роутер; REST-эндпоинты
 * регистрируются в опции `express`, WebSocket-транспорт привязывается к
 * нашему `httpServer` (передаётся конструктору транспорта).
 */
export function createGameServer() {
  const httpServer = http.createServer();

  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    express: (app) => {
      app.use(cors());
      app.use(express.json());
      app.get('/health', (_req, res) => {
        res.json({ ok: true, game: 'shadow-duel', protocol: PROTO_VERSION, ts: Date.now() });
      });
      app.get('/matches', async (_req, res) => {
        const limit = Math.min(200, Math.max(1, Number(_req.query.limit) || 20));
        res.json({ matches: await matchStore().list(limit) });
      });
    },
  });

  gameServer.define('heartbeat', HeartbeatRoom);
  // Боевая комната: joinOrCreate('fight') подбирает/создаёт матч 1v1 сам.
  gameServer.define('fight', FightRoom);

  return { httpServer, gameServer };
}