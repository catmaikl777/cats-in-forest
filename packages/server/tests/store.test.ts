/**
 * Единичные тесты персистентности матчей (JsonMatchStore).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { JsonMatchStore, configureMatchStore, matchStore } from '../src/store/JsonMatchStore';
import type { MatchRecord } from '../src/store/JsonMatchStore';

function tmpFile(): string {
  return `${process.env.TMPDIR ?? '/tmp'}/sf2-store-test-${process.pid}-${Math.random().toString(36).slice(2)}.jsonl`;
}

function rec(over: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: 'r1',
    roomId: 'abc',
    startedAt: 1000,
    endedAt: 4000,
    durationMs: 3000,
    winner: 0,
    reason: 'ko',
    wins: [2, 0],
    players: [
      { sessionId: 's1', name: 'a' },
      { sessionId: 's2', name: 'b' },
    ],
    ...over,
  };
}

describe('JsonMatchStore', () => {
  beforeEach(() => {
    configureMatchStore(null);
  });

  it('list на пустом/отсутствующем файле возвращает []', async () => {
    const store = new JsonMatchStore(tmpFile());
    expect(await store.list()).toEqual([]);
  });

  it('записывает и читает записи (новые — раньше), лимит обрезает', async () => {
    const store = new JsonMatchStore(tmpFile());
    await store.record(rec({ id: 'a' }));
    await store.record(rec({ id: 'b', winner: 1, wins: [0, 2] }));
    await store.record(rec({ id: 'c' }));

    const all = await store.list(10);
    expect(all.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    const limited = await store.list(1);
    expect(limited.map((r) => r.id)).toEqual(['c']);
    expect(limited[0]?.winner).toBe(0);
    expect(limited[0]?.players[0]?.name).toBe('a');
  });

  it('Игнорирует битые строки', async () => {
    const file = tmpFile();
    const store = new JsonMatchStore(file);
    await store.record(rec({ id: 'good' }));
    const { readFile, writeFile } = await import('node:fs/promises');
    const good = await readFile(file, 'utf8');
    await writeFile(file, 'not-json\n' + good);
    const rows = await store.list(5);
    expect(rows.map((r) => r.id)).toEqual(['good']);
  });

  it('singleton matchStore(): переопределяется configureMatchStore', () => {
    const custom = new JsonMatchStore(tmpFile());
    configureMatchStore(custom);
    expect(matchStore()).toBe(custom);
  });
});