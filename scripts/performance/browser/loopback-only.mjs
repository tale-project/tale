import { syncBuiltinESMExports } from 'node:module';
// Diagnostic process only. Block off-box socket connections before loading Tale.
import net from 'node:net';

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host =
    typeof first === 'object' && first !== null
      ? (first.host ?? 'localhost')
      : typeof first === 'number' && typeof args[1] === 'string'
        ? args[1]
        : 'localhost';
  if (
    ![
      'localhost',
      '127.0.0.1',
      '127.0.0.2',
      '::1',
      '::ffff:127.0.0.1',
    ].includes(host)
  ) {
    throw new Error(`Diagnostic refused off-box socket host: ${host}`);
  }
  return Reflect.apply(connect, this, args);
};
syncBuiltinESMExports();
