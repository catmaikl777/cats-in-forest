/**
 * Смоук реального клиентского слоя (net/NetClient) против живого сервера:
 * подключение -> welcome -> статус connected -> echo-пинг.
 * Запуск: node node_modules/tsx/dist/cli.mjs scripts/smoke-net.ts
 */
import { NetClient } from '../src/net/NetClient';
import { PROTO_VERSION } from '@sf/shared';

const URL = process.env.SERVER_URL ?? 'ws://localhost:2567';
const name = `smoke_${Math.floor(Math.random() * 10000)}`;

const net = new NetClient(URL);
net.onStatusChange = (s) => console.log(`[status] ${s}`);

try {
  await net.connect(name);
  if (net.status !== 'connected') throw new Error(`status=${net.status}, ждали connected`);
  if (!net.sessionId) throw new Error('sessionId пустой');
  console.log(`[ok] connected sessionId=${net.sessionId} latency=${net.connectLatencyMs}ms`);
  if (net.serverPlayers !== 1) console.log(`[warn] serverPlayers=${net.serverPlayers}, ждали 1`);

  const pong = await net.ping();
  console.log(`[ok] echo="${pong.echo}" serverTime=${pong.serverTime}`);

  await new Promise<void>((r) => {
    net.onStatusChange = (s) => {
      if (s === 'disconnected') r();
    };
    void net.disconnect();
  });
  console.log('[ok] disconnect clean');
  process.exit(0);
} catch (err) {
  console.error('[FAIL]', err instanceof Error ? err.message : err);
  process.exit(1);
}