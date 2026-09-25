import fs from 'node:fs';
import path from 'node:path';

/**
 * Запись результата одного боя. Складывается в JSONL (одна строка = матч),
 * чтобы дописывать без перезаписи всего файла и без локов.
 */
export interface MatchRecord {
  id: string;
  roomId: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  winner: 0 | 1;
  reason: 'ko' | 'time' | 'dq';
  wins: [number, number];
  players: { sessionId: string; name: string }[];
}

/**
 * JsonMatchStore — персистентность матчей на диск. Асинхронная очередь
 * гарантирует сериализацию записей; сбои диска не роняют игровой сервер
 * (логируются и пропускаются).
 */
export class JsonMatchStore {
  private readonly file: string;
  private readonly log: (...a: unknown[]) => void;
  private chain: Promise<void> = Promise.resolve();

  constructor(file: string, log: (...a: unknown[]) => void = console.error) {
    this.file = file;
    this.log = log;
  }

  /** Дозаписывает запись (JSONL). Ошибки диска логируются, а не бросаются. */
  record(rec: MatchRecord): Promise<void> {
    this.chain = this.chain.then(async () => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        await fs.promises.appendFile(this.file, JSON.stringify(rec) + '\n', 'utf8');
      } catch (err) {
        this.log('[store] запись матча не удалась', err);
      }
    });
    return this.chain;
  }

  /** Последние N записей (новые раньше). [] если файла ещё нет. */
  async list(limit = 20): Promise<MatchRecord[]> {
    try {
      const raw = await fs.promises.readFile(this.file, 'utf8');
      const rows: MatchRecord[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          rows.push(JSON.parse(line) as MatchRecord);
        } catch {
          /* битая строка — пропускаем */
        }
      }
      return rows.slice(-limit).reverse();
    } catch {
      return [];
    }
  }
}

function defaultFile(): string {
  return process.env.MATCHES_FILE ?? path.join(process.cwd(), 'data', 'matches.jsonl');
}

let store: JsonMatchStore | null = null;

/** Переопределить хранилище (тесты). */
export function configureMatchStore(s: JsonMatchStore | null): void {
  store = s;
}

export function matchStore(): JsonMatchStore {
  if (!store) store = new JsonMatchStore(defaultFile());
  return store;
}