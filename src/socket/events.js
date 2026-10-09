// Central registry of Socket.IO event names and shared constants.
// To add a new event: add it here, define its payload/validation in
// payloads.js, create a handler in handlers/ and register it in
// SocketServer.registerSocketHandlers. All events require the
// authenticated handshake (see auth.js). Full guide in README.md.

export const SOCKET_EVENTS = {
  DATA: 'data',
  STATUS: 'status',
  OK: 'ok',
  ERROR: 'error',
  ZERO: 'zero',
};

// Device-level status values emitted through the `status` event.
export const DEVICE_STATUS = {
  STARTING: 'starting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  NO_RESPONSE: 'no_response',
  ERROR: 'error',
};

// Closed set of weight units shared with the web application.
export const WEIGHT_UNITS = ['mg', 'dg', 'g', 'kg', 't', 'oz', 'lb'];

export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  UNSUPPORTED_WEIGHT_UNIT: 'UNSUPPORTED_WEIGHT_UNIT',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  MAX_CLIENTS_REACHED: 'MAX_CLIENTS_REACHED',
};

export function isSupportedWeightUnit(unit) {
  return WEIGHT_UNITS.includes(unit);
}
