import { Client, type Room } from '@colyseus/sdk';
import { HeartbeatState, PROTO_VERSION } from '@sf/shared';

/** Статус соединения, которым живёт React-лобби. */
export type NetStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * NetClient — слой клиента к Colyseus: лобби/боевые комнаты.
 *
 * На этапе 2 умеет только коннект к HeartbeatRoom и приём welcome/echo.
 * На этапах 4-5 сюда добавятся: джойн боевых комнат, отправка входов
 * и приём бинарных снапшотов.
 */
export class NetClient {
  private readonly client: Client;
  private room: Room<any, HeartbeatState> | null = null;

  status: NetStatus = 'disconnected';
  sessionId = '';
  lastError: string | null = null;
  serverTime = 0;
  serverPlayers = 0;

  /** Пинг в мс, измеряется на приветствии. */
  connectLatencyMs = -1;
  connectStartedAt = 0;
  private isConnecting = false;

  onStatusChange: ((status: NetStatus) => void) | null = null;

  constructor(serverUrl: string) {
    this.client = new Client(serverUrl);
  }

async connect(friendlyName: string): Promise<void> {
    if (this.isConnecting) {
      throw new Error('уже подключаюсь');
    }
    this.isConnecting = true;
    this.setStatus('connecting');
    this.connectStartedAt = Date.now();
    try {
      this.room = await this.client.joinOrCreate<HeartbeatState>(
        'heartbeat',
        {
          name: friendlyName,
          version: PROTO_VERSION,
        },
        HeartbeatState,
      );
      const room = this.room;
      this.sessionId = room.sessionId;

      // Welcome (client.send) уходит во время хендшейка — к моменту нашего
      // joinOrCreate он уже обработан SDK и обработчик тут его не увидит.
      // Поэтому версию/латентность детектируем по ПЕРВОМУ state-патчу:
      // сервер шлёт полный state при подключении, гарантированно.
      // `connect()` резолвится ТОЛЬКО после подтверждения канала.
      let settled = false;
      const confirmed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('нет ответа от сервера (state-таймаут)')),
          4000,
        );
        const settle = (serverTime: number, version: number): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.serverTime = serverTime;
          this.connectLatencyMs = Date.now() - this.connectStartedAt;
          if (version !== PROTO_VERSION) {
            this.lastError = `Версия протокола сервера (${version}) не совпадает с клиентской (${PROTO_VERSION})`;
            this.setStatus('error');
            reject(new Error(this.lastError));
            return;
          }
          this.setStatus('connected');
          resolve();
        };

        const initial = room.state;
        if (typeof initial.version === 'number') {
          settle(initial.serverTime, initial.version);
        }

        room.onStateChange((state) => {
          this.serverTime = state.serverTime;
          this.serverPlayers = state.players;
          if (typeof state.version === 'number') {
            settle(state.serverTime, state.version);
          }
        });
      });
      await confirmed;

      room.onLeave(() => {
        this.room = null;
        this.setStatus('disconnected');
      });
      // Сервер шлёт welcome для лобби; здесь он избыточен (версия/тайминги
      // уже пришли в state) — потребляем, чтобы SDK не логировал пропуск.
      room.onMessage('welcome', () => {});
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.setStatus('error');
      throw err;
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.room?.leave();
    } catch {
      /* не критично */
    }
    this.room = null;
    this.setStatus('disconnected');
  }

  /** Проверка канала «клиент -> сервер -> клиент» (эхо). */
  async ping(): Promise<{ serverTime: number; echo: string }> {
    if (!this.room) throw new Error('нет подключения');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ping timeout')), 4000);
      this.room!.onMessage('echo', (msg: { name: string; serverTime: number }) => {
        clearTimeout(timer);
        resolve({ serverTime: msg.serverTime, echo: String(msg.name) });
      });
      this.room!.send('hello', `ping-${Date.now()}`);
    });
  }

  private setStatus(status: NetStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatusChange?.(status);
  }
}