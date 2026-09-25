import { Client } from '@colyseus/sdk';
import { HeartbeatState } from '../../shared/src/net/state';

const client = new Client('ws://localhost:2567');
client.onError??(console.error);
const room = await client.joinOrCreate('heartbeat', { name: 'dbg' }, HeartbeatState);
console.log('joined:', room.roomId, room.sessionId);
room.onMessage('*', (type: unknown, msg: unknown) => {
  console.log('message', type, JSON.stringify(msg).slice(0, 200));
});
room.onStateChange((state, change?) => {
  console.log('stateChange players=', (state as HeartbeatState).players, 'serverTime=', (state as HeartbeatState).serverTime);
});
setTimeout(async () => {
  console.log('final state', room.state);
  await room.leave();
  process.exit(0);
}, 6000);