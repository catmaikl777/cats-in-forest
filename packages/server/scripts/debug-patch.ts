import { Room, type Client } from '@colyseus/core';
import { Client as SdkClient } from '@colyseus/sdk';
import { HeartbeatState } from '../../shared/src/net/state';
import { createGameServer } from '../src/index';

class ProbeRoom extends Room<HeartbeatState> {
  override onCreate(): void {
    this.setState(new HeartbeatState());
    this.state.players = 0;
    this.state.serverTime = 0;
    this.state.version = 1;
    this.setTimestep(() => {
      this.state.serverTime += 1;
      console.log('[tick] serverTime=', this.state.serverTime);
    }, 1000);
    this.onMessage('hello', (client: Client, name: unknown) => {
      client.send('echo', { name, serverTime: this.state.serverTime });
    });
  }
  override onJoin(client: Client): void {
    this.state.players += 1;
    client.send('welcome', { sessionId: client.sessionId, version: 1, serverTime: this.state.serverTime });
  }
}

const { httpServer, gameServer } = createGameServer();
gameServer.define('probe', ProbeRoom);
await gameServer.listen(2578);

const client = new SdkClient('ws://localhost:2578');
const room = await client.joinOrCreate('probe', { name: 'probe' }, HeartbeatState);
console.log('[client] joined', room.sessionId);
room.onStateChange((state) => {
  const s = state as HeartbeatState;
  console.log('[client] state players=', s.players, 'serverTime=', s.serverTime);
});
room.onMessage('welcome', (m: unknown) => console.log('[client] welcome', JSON.stringify(m)));

setTimeout(async () => {
  const s = room.state as HeartbeatState;
  console.log('[client] final players=', s.players, 'serverTime=', s.serverTime);
  await room.leave();
  await new Promise<void>((r) => httpServer.close(() => r()));
  process.exit(0);
}, 6800);