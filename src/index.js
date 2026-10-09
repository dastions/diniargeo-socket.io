import fs from 'fs';
import http from 'http';
import https from 'https';

import Armari from "./modules";
import SocketServer from "./socket/SocketServer";
import { isTokenConfigured } from "./socket/auth";

const PORT = process.env.HTTP_PORT || 3000;

const machine = {
  name: process.env.BASCULA_NAME,
  id: process.env.BASCULA_ID,
  units: process.env.BASCULA_UNITS,
  ip: process.env.DEVICE_IP,
  port: process.env.DEVICE_PORT,

  com: process.env.SERIAL_COM,
  regex: process.env.SERIAL_REGEX,
  baudRate: process.env.SERIAL_BAUDRATE,
  dataBits: process.env.SERIAL_DATABITS,
  stopBits: process.env.SERIAL_STOPBITS,
  parity: process.env.SERIAL_PARITY,

  readIntervalMs: process.env.SCALE_READ_INTERVAL_MS || process.env.SOCKET_DATA_INTERVAL_MS,
  responseTimeoutMs: process.env.SCALE_RESPONSE_TIMEOUT_MS,
  debug: process.env.DEBUG === 'true',
};

const armari = new Armari({ machine });

// HTTPS (WSS) when certificate paths are configured, plain HTTP otherwise.
const useTLS = process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH;
const server = useTLS
  ? https.createServer({
      key: fs.readFileSync(process.env.SSL_KEY_PATH),
      cert: fs.readFileSync(process.env.SSL_CERT_PATH),
    })
  : http.createServer();

// The Socket.IO server only starts when the device token is configured.
if (isTokenConfigured()) {
  new SocketServer({
    httpServer: server,
    armari: armari,
    allowedOrigins: process.env.SOCKET_ALLOWED_ORIGINS,
    maxClients: process.env.SOCKET_MAX_CLIENTS,
    dataIntervalMs: process.env.SOCKET_DATA_INTERVAL_MS,
  });
  console.log(`> Socket.IO server enabled (${useTLS ? 'wss' : 'ws'})`);
} else {
  console.log("> Socket.IO server disabled: DEVICE_SOCKET_TOKEN is not configured");
}

server.listen(PORT, (error) => {
  if (error) {
    return console.log(error);
  }
  console.log(`> Server is running on port ${PORT}`);
});
