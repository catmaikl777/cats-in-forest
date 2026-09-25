/**
 * Боевой интеграционный тест: два реальных SDK-клиента, бинарный канал,
 * полный матч до MatchResult.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@colyseus/sdk';
import {
  Opcode,
  FightRoomState,
  packInputFrame,
  unpackWorld,
  unpackEvent,
  unpackMatchResult,
  DirBit,
  ButtonBit,
} from '@sf/shared';
import { createGameServer } from '../src/index';
import { configureMatchStore, JsonMatchStore } from '../src/store/JsonMatchStore';

let httpServer: ReturnType<typeof createGameServer>['httpServer'];
let gameServer: ReturnType<typeof createGameServer>['gameServer'];
let port: number;

function tmpFile(): string {
  return `${process.env.TMPDIR ?? '/tmp'}/sf2-test-matches-${process.pid}-${Date.now()}.jsonl`;
}

beforeAll(async () => {
  configureMatchStore(new JsonMatchStore(tmpFile()));
  const created = createGameServer();
  httpServer = created.httpServer;
  gameServer = created.gameServer;
  port = 22000 + Math.floor(Math.random() * 900);
  await gameServer.listen(port);
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

const W = DirBit.W as number;
const PUNCH = ButtonBit.PUNCH as number;

type AnyRoom = Awaited<ReturnType<typeof joinFight>>['room'];

function startInputs(room: AnyRoom, makeWord: (t: number) => number): () => void {
  let tick = 0;
  const timer = setInterval(() => {
    room.sendBytes(Opcode.InputFrame, packInputFrame(tick, makeWord(tick)));
    tick += 1;
  }, 16);
  return () => clearInterval(timer);
}

async function joinFight(client: Client) {
  const room = await client.joinOrCreate('fight', { name: 't' }, FightRoomState);
  return { client, room };
}

function waitFor<T>(check: () => T | null, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      const v = check();
      if (v !== null) {
        clearInterval(iv);
        resolve(v);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(iv);
        reject(new Error('waitFor timeout'));
      }
    }, 100);
  });
}

describe('FightRoom (матч 1v1)', () => {
  it('сводит двух игроков: снапшоты, события, KO, MatchResult', async () => {
    const cA = new Client(`ws://localhost:${port}`);
    const cB = new Client(`ws://localhost:${port}`);
    const a = await joinFight(cA);
    const b = await joinFight(cB);

    const snapA: ReturnType<typeof unpackWorld>[] = [];
    const snapB: ReturnType<typeof unpackWorld>[] = [];
    const evA: ReturnType<typeof unpackEvent>[] = [];
    const evB: ReturnType<typeof unpackEvent>[] = [];

    a.room.onMessage(Opcode.Snapshot, (bytes: Uint8Array) => snapA.push(unpackWorld(bytes)));
    b.room.onMessage(Opcode.Snapshot, (bytes: Uint8Array) => snapB.push(unpackWorld(bytes)));
    a.room.onMessage(Opcode.RoundEvent, (bytes: Uint8Array) => evA.push(unpackEvent(bytes)));
    b.room.onMessage(Opcode.RoundEvent, (bytes: Uint8Array) => evB.push(unpackEvent(bytes)));

    const matchResult = new Promise<ReturnType<typeof unpackMatchResult>>((resolve) => {
      b.room.onMessage(Opcode.MatchResult, (bytes: Uint8Array) => resolve(unpackMatchResult(bytes)));
    });

    // A стоит и бьёт; B идёт напрашиваться в удары.
    const stopA = startInputs(a.room, (t) => (t % 6 === 0 ? PUNCH : 0));
    const stopB = startInputs(b.room, () => W);

    // Оба клиента получили снапшоты одного и того же мира.
    await waitFor(() => (snapA.length >= 2 && snapB.length >= 2 ? true : null), 15000);
    const baseA = snapA[snapA.length - 1] ?? snapA[0];
    const baseB = snapB[snapB.length - 1] ?? snapB[0];
    expect(baseA).toBeDefined();
    expect(baseB).toBeDefined();
    if (baseA && baseB) waitForBase(baseA, baseB);

    // Были удары.
    await waitFor(() => (evA.some((e) => e.type === 'hit') ? true : null), 20000);
    const hitsA = evA.filter((e) => e.type === 'hit').length;
    const hitsB = evB.filter((e) => e.type === 'hit').length;
    expect(hitsA).toBeGreaterThan(0);
    expect(hitsB).toBeGreaterThan(0);

    // Результат матча: победа A в двух раундах.
    const result = await matchResult;
    expect(result.winner).toBe(0);
    expect(result.wins[0]).toBeGreaterThanOrEqual(2);

    stopA();
    stopB();
    await a.room.leave();
    await b.room.leave();
  }, 40000);
});

function waitForBase(a: ReturnType<typeof unpackWorld>, b: ReturnType<typeof unpackWorld>): void {
  expect(a.tick).toBeGreaterThan(0);
  expect(a.phase).toBe(b.phase);
  expect(a.fighters[0].side).toBe(0);
  expect(a.fighters[1].side).toBe(1);
}