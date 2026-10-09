import crypto from 'crypto';

import { ERROR_CODES } from './events';

// The device token is only read from the environment; it must never be
// hardcoded, logged or sent through URL parameters.

export function isTokenConfigured() {
  const token = process.env.DEVICE_SOCKET_TOKEN;
  return typeof token === 'string' && token.length > 0;
}

export function isValidToken(token) {
  if (!isTokenConfigured())
    return false;

  if (typeof token !== 'string' || token.length === 0)
    return false;

  const received = Buffer.from(token);
  const expected = Buffer.from(process.env.DEVICE_SOCKET_TOKEN);

  if (received.length !== expected.length)
    return false;

  return crypto.timingSafeEqual(received, expected);
}

// socket.io middleware: rejects the handshake before any event handler
// is registered, so no event is reachable without authentication.
export function authMiddleware(socket, next) {
  const token = socket.handshake.auth?.token;

  if (!isValidToken(token))
    return next(new Error(ERROR_CODES.UNAUTHORIZED));

  next();
}
