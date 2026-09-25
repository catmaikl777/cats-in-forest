import { Room, type Client } from '@colyseus/core';
import { PROTO_VERSION, HeartbeatState } from '@sf/shared';

/**
 * HeartbeatRoom — простейшая комната для проверки канала клиент<->сервер
 * (этап 2). Позже становится LobbyRoom: очередь, приглашения, готовность.
 */
export class HeartbeatRoom extends Room<{ state: HeartbeatState }> {
  override onCreate(): void {
    this.setState(new HeartbeatState());
    this.state.players = 0;
    this.state.serverTime = 0;
    this.state.version = PROTO_VERSION;

    // Сердцебиение: раз в секунду продвигаем «серверное время», клиент
    // видит живой поток состояния.
    this.setTimestep(() => {
      this.state.serverTime += 1;
    }, 1000);

    this.onMessage('hello', (client: Client, name: unknown) => {
      client.send('echo', { name, serverTime: this.state.serverTime });
    });
  }

  override onJoin(client: Client): void {
    this.state.players += 1;
    client.send('welcome', {
      sessionId: client.sessionId,
      version: PROTO_VERSION,
      serverTime: this.state.serverTime,
    });
  }

  override onLeave(_client: Client): void {
    if (this.state.players > 0) this.state.players -= 1;
  }
}