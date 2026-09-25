/**
 * Интеграционный тест этапа 2: живой Colyseus-сервер + реальный WS-клиент.
 * Два клиента подключаются к heartbeat-комнате и получают welcome.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@colyseus/sdk';
import { HeartbeatState, PROTO_VERSION } from '@sf/shared';
import { createGameServer } from '../src/index';

let httpServer: ReturnType<typeof createGameServer>['httpServer'];
let gameServer: ReturnType<typeof createGameServer>['gameServer'];
let port: number;

beforeAll(async () => {
  const created = createGameServer();
  httpServer = created.httpServer;
  gameServer = created.gameServer;
  port = 21000 + Math.floor(Math.random() * 900);
  await gameServer.listen(port);
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe('HeartbeatRoom (канал клиент->сервер)', () => {
  it('приветствует клиента с версией протокола и sessionId', async () => {
    const client = new Client(`ws://localhost:${port}`);
    const room = await client.joinOrCreate('heartbeat', { name: 'tester', version: PROTO_VERSION }, HeartbeatState);

    const welcome = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('welcome timeout')), 5000);
      room.onMessage('welcome', (msg: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });

    expect(welcome.version).toBe(PROTO_VERSION);
    expect(typeof welcome.sessionId).toBe('string');
    expect(room.sessionId).toBeTruthy();

    await room.leave();
  });

  it('поддерживает двух игроков одновременно и инкрементирует счётчик', async () => {
    const a = new Client(`ws://localhost:${port}`);
    const b = new Client(`ws://localhost:${port}`);
    const roomA = await a.joinOrCreate('heartbeat', { name: 'a' }, HeartbeatState);
    const roomB = await b.joinOrCreate('heartbeat', { name: 'b' }, HeartbeatState);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('players timeout')), 5000);
      const check = (players = roomA.state.players): void => {
        if (players >= 2) {
          clearTimeout(timer);
          resolve();
        }
      };
      check();
      if (roomA.state.players < 2) {
        roomA.onStateChange((state) => check(state.players));
      }
    });

    expect(roomA.state.players).toBeGreaterThanOrEqual(2);

    await roomA.leave();
    await roomB.leave();
  });
});