import http from 'http';
import fs from 'fs';
import path from 'path';

import { io as ioClient } from 'socket.io-client';

import SocketServer from '../SocketServer';
import { SOCKET_EVENTS, DEVICE_STATUS, ERROR_CODES } from '../events';

const TOKEN = 'test-device-token';

function createFakeArmari() {
  return {
    device: {
      id: 'scale-1',
      isConnected: true,
      responding: true,
      data: { id: 'scale-1', weight: 1000, tare: null, net: null, units: 'kg', status: 'ST', mode: 'GS' },
    },
    handleOk: jest.fn(),
    handleError: jest.fn(),
    handleZero: jest.fn(),
  };
}

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

describe('SocketServer', () => {
  let httpServer;
  let socketServer;
  let armari;
  let port;
  let clients;

  function connectClient(auth) {
    const client = ioClient(`http://127.0.0.1:${port}`, {
      auth,
      transports: ['websocket'],
      reconnection: false,
    });
    clients.push(client);
    return client;
  }

  beforeEach((done) => {
    process.env.DEVICE_SOCKET_TOKEN = TOKEN;
    clients = [];
    armari = createFakeArmari();
    httpServer = http.createServer();
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      socketServer = new SocketServer({
        httpServer,
        armari,
        maxClients: 1,
        dataIntervalMs: 50,
        allowedOrigins: 'http://localhost:5173',
      });
      done();
    });
  });

  afterEach(async () => {
    clients.forEach((client) => client.disconnect());
    if (SocketServer.instance)
      await socketServer.close();
    if (httpServer.listening)
      await new Promise((resolve) => httpServer.close(resolve));
    delete process.env.DEVICE_SOCKET_TOKEN;
  });

  it('accepts a connection with a valid token', async () => {
    const client = connectClient({ token: TOKEN });
    await waitFor(client, 'connect');
    expect(client.connected).toBe(true);
  });

  it('rejects a connection without token', async () => {
    const client = connectClient({});
    const error = await waitFor(client, 'connect_error');
    expect(error.message).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(client.connected).toBe(false);
  });

  it('rejects a connection with a wrong token', async () => {
    const client = connectClient({ token: 'wrong-token' });
    const error = await waitFor(client, 'connect_error');
    expect(error.message).toBe(ERROR_CODES.UNAUTHORIZED);
  });

  it('emits the current status to a client right after connecting', async () => {
    const client = connectClient({ token: TOKEN });
    const payload = await waitFor(client, SOCKET_EVENTS.STATUS);
    expect(Object.values(DEVICE_STATUS)).toContain(payload.status);
    expect(payload.timestamp).toBeDefined();
  });

  it('emits data events with the full reading format', async () => {
    const client = connectClient({ token: TOKEN });
    const payload = await waitFor(client, SOCKET_EVENTS.DATA);
    expect(payload).toMatchObject({
      id: 'scale-1',
      weight: 1000,
      units: 'kg',
      tare: null,
      net: null,
      status: 'ST',
      mode: 'GS',
    });
  });

  it('emits connected status derived from the device', async () => {
    const client = connectClient({ token: TOKEN });
    await waitFor(client, 'connect');
    const statuses = [];
    client.on(SOCKET_EVENTS.STATUS, (payload) => statuses.push(payload.status));
    await waitFor(client, SOCKET_EVENTS.DATA);
    expect(statuses).toContain(DEVICE_STATUS.CONNECTED);
  });

  async function waitForStatus(client, status) {
    let payload;
    do payload = await waitFor(client, SOCKET_EVENTS.STATUS);
    while (payload.status !== status);
    return payload;
  }

  it('emits no_response when the interface is connected but the scale does not answer', async () => {
    const client = connectClient({ token: TOKEN });
    await waitForStatus(client, DEVICE_STATUS.CONNECTED);

    armari.device.responding = false;
    await waitForStatus(client, DEVICE_STATUS.NO_RESPONSE);

    armari.device.responding = true;
    await waitForStatus(client, DEVICE_STATUS.CONNECTED);
  });

  it('emits disconnected when the interface is down', async () => {
    const client = connectClient({ token: TOKEN });
    await waitForStatus(client, DEVICE_STATUS.CONNECTED);

    armari.device.isConnected = false;
    await waitForStatus(client, DEVICE_STATUS.DISCONNECTED);
  });

  it('does not emit data while the device has no reading', async () => {
    armari.device.data = null;
    const client = connectClient({ token: TOKEN });
    await waitFor(client, 'connect');

    const received = [];
    client.on(SOCKET_EVENTS.DATA, (payload) => received.push(payload));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received).toHaveLength(0);
  });

  it('does not emit data when the device unit is unsupported', async () => {
    armari.device.data.units = 'st';
    const client = connectClient({ token: TOKEN });
    await waitFor(client, 'connect');

    const received = [];
    client.on(SOCKET_EVENTS.DATA, (payload) => received.push(payload));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received).toHaveLength(0);
  });

  it("delivers 'ok' events to the main class", async () => {
    const client = connectClient({ token: TOKEN });
    await waitFor(client, 'connect');

    client.emit(SOCKET_EVENTS.OK, { weight: 1000, units: 'kg' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(armari.handleOk).toHaveBeenCalledWith({ weight: 1000, units: 'kg' });
  });

  it("delivers 'error' events to the main class", async () => {
    const client = connectClient({ token: TOKEN });
    await waitFor(client, 'connect');

    client.emit(SOCKET_EVENTS.ERROR, { reason: 'out-of-tolerance' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(armari.handleError).toHaveBeenCalledWith({ reason: 'out-of-tolerance' });
  });

  it("delivers 'zero' to the main class without answering the client (G-03)", async () => {
    const client = connectClient({ token: TOKEN });
    await waitFor(client, 'connect');

    const answers = [];
    client.on(SOCKET_EVENTS.ERROR, (payload) => answers.push(payload));
    client.emit(SOCKET_EVENTS.ZERO, {});
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(armari.handleZero).toHaveBeenCalled();
    expect(answers).toHaveLength(0);
  });

  it("ignores the removed 'tare' event (tare is frontend-only)", async () => {
    const client = connectClient({ token: TOKEN });
    await waitFor(client, 'connect');

    client.emit('tare', {});
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(armari.handleZero).not.toHaveBeenCalled();
    expect(client.connected).toBe(true);
  });

  it('rejects invalid payloads without reaching the main class', async () => {
    const client = connectClient({ token: TOKEN });
    await waitFor(client, 'connect');

    client.emit(SOCKET_EVENTS.OK, 'not-an-object');
    const answer = await waitFor(client, SOCKET_EVENTS.ERROR);

    expect(answer.code).toBe(ERROR_CODES.INVALID_PAYLOAD);
    expect(armari.handleOk).not.toHaveBeenCalled();
  });

  it('rejects payloads with unsupported units', async () => {
    const client = connectClient({ token: TOKEN });
    await waitFor(client, 'connect');

    client.emit(SOCKET_EVENTS.OK, { weight: 10, units: 'st' });
    const answer = await waitFor(client, SOCKET_EVENTS.ERROR);

    expect(answer.code).toBe(ERROR_CODES.UNSUPPORTED_WEIGHT_UNIT);
    expect(armari.handleOk).not.toHaveBeenCalled();
  });

  it('enforces the SOCKET_MAX_CLIENTS limit', async () => {
    const first = connectClient({ token: TOKEN });
    await waitFor(first, 'connect');

    const second = connectClient({ token: TOKEN });
    const error = await waitFor(second, 'connect_error');

    expect(error.message).toBe(ERROR_CODES.MAX_CLIENTS_REACHED);
    expect(second.connected).toBe(false);
    expect(first.connected).toBe(true);
  });

  it('frees the slot when a client disconnects', async () => {
    const first = connectClient({ token: TOKEN });
    await waitFor(first, 'connect');
    first.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const second = connectClient({ token: TOKEN });
    await waitFor(second, 'connect');
    expect(second.connected).toBe(true);
  });

  it('allows a single active instance', () => {
    expect(() => new SocketServer({ httpServer, armari })).toThrow(/only one instance/);
  });

  it('clears its interval, listeners and instance on close', async () => {
    const client = connectClient({ token: TOKEN });
    await waitFor(client, 'connect');

    await socketServer.close();

    expect(socketServer.interval).toBeNull();
    expect(socketServer.clients.size).toBe(0);
    expect(SocketServer.instance).toBeNull();
    await waitFor(client, 'disconnect');
  });

  it('keeps no reference to the previous socket.io-client implementation', () => {
    const srcDir = path.join(__dirname, '..', '..');

    const offenders = [];
    const scan = (dir) => {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== '__tests__')
          return scan(fullPath);
        if (entry.isFile() && fullPath.endsWith('.js') && fs.readFileSync(fullPath, 'utf-8').includes('socket.io-client'))
          offenders.push(fullPath);
      });
    };
    scan(srcDir);

    expect(offenders).toEqual([]);
  });
});
