import { Server } from 'socket.io';

import { SOCKET_EVENTS, DEVICE_STATUS, ERROR_CODES } from './events';
import { authMiddleware } from './auth';
import { buildDataPayload, buildStatusPayload } from './payloads';
import { createOkHandler } from './handlers/ok-handler';
import { createErrorHandler } from './handlers/error-handler';
import { createZeroHandler } from './handlers/zero-handler';
import { createCommandHandler } from './handlers/command-handler';

const DEFAULT_DATA_INTERVAL_MS = 1000;
const DEFAULT_MAX_CLIENTS = 1;

// Communication adapter between the existing main class (Armari) and the
// operator frontend: main class <-> Socket.IO <-> operator screen.
// It contains no scale business logic; it only reads the device exposed by
// the main class and delivers validated events back to it.
class SocketServer {
  static instance = null;

  constructor(params = {}) {
    if (SocketServer.instance)
      throw new Error('SocketServer already running: only one instance is allowed');

    this.armari = params.armari;
    this.dataIntervalMs = parseInt(params.dataIntervalMs) || DEFAULT_DATA_INTERVAL_MS;
    this.maxClients = parseInt(params.maxClients) || DEFAULT_MAX_CLIENTS;
    this.allowedOrigins = (params.allowedOrigins || '')
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean);

    this.clients = new Set();
    this.lastStatus = null;
    this.lastDataError = null;
    this.interval = null;

    this.io = new Server(params.httpServer, {
      cors: { origin: this.allowedOrigins },
      allowRequest: this.originCheck.bind(this),
    });

    this.io.use(authMiddleware);
    this.io.use(this.capacityMiddleware.bind(this));
    this.io.on('connection', this.handleConnection.bind(this));

    this.emitStatus(DEVICE_STATUS.STARTING);
    this.startDataInterval();

    SocketServer.instance = this;
  }

  // Browsers do not apply CORS to WebSocket upgrades, so `cors` alone does
  // not stop another site from opening a socket: the Origin header is checked
  // on every handshake. Requests without Origin (non-browser clients) are let
  // through: they can forge it anyway and still need the device token.
  originCheck(req, callback) {
    const origin = req.headers.origin;

    if (!origin || this.allowedOrigins.includes(origin))
      return callback(null, true);

    console.log(`Socket.IO: connection rejected (${ERROR_CODES.FORBIDDEN_ORIGIN}: ${origin})`);
    callback(ERROR_CODES.FORBIDDEN_ORIGIN, false);
  }

  // Rejects the handshake when the plan limit is reached, so the client
  // receives a deterministic connect_error instead of a silent drop.
  capacityMiddleware(socket, next) {
    if (this.clients.size >= this.maxClients) {
      console.log(`Socket.IO: connection rejected (${ERROR_CODES.MAX_CLIENTS_REACHED})`);
      return next(new Error(ERROR_CODES.MAX_CLIENTS_REACHED));
    }

    next();
  }

  handleConnection(socket) {
    // Authoritative re-check: concurrent handshakes could pass the
    // middleware before either connection is registered.
    if (this.clients.size >= this.maxClients) {
      console.log(`Socket.IO: connection rejected (${ERROR_CODES.MAX_CLIENTS_REACHED})`);
      socket.disconnect(true);
      return;
    }

    this.clients.add(socket.id);
    console.log(`Socket.IO: client connected (${this.clients.size}/${this.maxClients})`);

    this.registerSocketHandlers(socket);

    // Let the new client know the current device status right away.
    const payload = buildStatusPayload(this.lastStatus || DEVICE_STATUS.STARTING);
    if (payload)
      socket.emit(SOCKET_EVENTS.STATUS, payload);
  }

  registerSocketHandlers(socket) {
    socket.on(SOCKET_EVENTS.OK, createOkHandler(this.armari, socket));
    socket.on(SOCKET_EVENTS.ERROR, createErrorHandler(this.armari, socket));
    socket.on(SOCKET_EVENTS.ZERO, createZeroHandler(this.armari, socket));
    socket.on(SOCKET_EVENTS.COMMAND, createCommandHandler(this.armari, socket));
    socket.on('disconnect', () => this.handleDisconnection(socket));
  }

  handleDisconnection(socket) {
    this.clients.delete(socket.id);
    console.log(`Socket.IO: client disconnected (${this.clients.size}/${this.maxClients})`);
  }

  startDataInterval() {
    this.interval = setInterval(() => {
      try {
        this.emitData();
        this.emitStatus(this.resolveDeviceStatus());
      } catch (error) {
        console.log(`Socket.IO: emit failed (${error.message})`);
        this.emitStatus(DEVICE_STATUS.ERROR);
      }
    }, this.dataIntervalMs);
  }

  emitData() {
    const { payload, error } = buildDataPayload(this.armari?.device);

    if (error && error !== this.lastDataError)
      console.log(`Socket.IO: reading discarded (${error})`);
    this.lastDataError = error;

    if (payload)
      this.io.emit(SOCKET_EVENTS.DATA, payload);
  }

  emitStatus(status) {
    if (status === this.lastStatus)
      return;

    const payload = buildStatusPayload(status);
    if (!payload)
      return;

    this.lastStatus = status;
    this.io.emit(SOCKET_EVENTS.STATUS, payload);
  }

  resolveDeviceStatus() {
    const device = this.armari?.device;

    if (!device)
      return DEVICE_STATUS.ERROR;

    if (!device.isConnected)
      return DEVICE_STATUS.DISCONNECTED;

    // Interface connected but the scale does not answer READ/ZERO.
    if (device.responding === false)
      return DEVICE_STATUS.NO_RESPONSE;

    return DEVICE_STATUS.CONNECTED;
  }

  close() {
    return new Promise((resolve) => {
      clearInterval(this.interval);
      this.interval = null;
      this.clients.clear();

      this.io.removeAllListeners();
      this.io.close(() => {
        SocketServer.instance = null;
        resolve();
      });
    });
  }
}

export default SocketServer;
