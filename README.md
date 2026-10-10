# DTM i4.0 — Local scale application (dtmi4-socket)

Node.js application installed locally next to each scale. It reads the weight
from the scale through serial commands and exposes a **Socket.IO server** so
that the operator screen of the *Batch Control Dosage* web application receives
the weight in real time and can zero the scale.

```text
Scale (hardware)
   ↑↓  READ / ZERO commands  (serial port or TCP)
Scale class (src/modules/Scale.js)
   ↑↓
Armari (src/modules/index.js)
   ↑↓
Socket.IO server (src/socket/SocketServer.js)
   ↑↓  WS / WSS
Operator frontend (dosage-frontend)
```

The frontend gets the `socket_url` and the device token from dosage-api
(`GET /api/scales`, `POST /api/scales/:id/token`) and connects directly to
this application's Socket.IO server.

**Tare is frontend-only**: the scale always reports the weight it reads and
the web application computes the net weight locally.

## Models (`MACHINE_MODEL`)

| Value | Device |
|---|---|
| *(empty)* | Real scale: `Scale` class, `READ` / `ZERO` commands |
| `test` | Simulator with no interface: `READ` returns a random weight and `ZERO` sets it to zero |

## Scale communication (`Scale` class)

The interface is chosen from the `.env`: with `SERIAL_COM`, `SerialConnection`
is used; otherwise `DEVICE_IP`/`DEVICE_PORT` with `SocketConnection` (TCP).
Whatever the interface, the scale is controlled with text commands terminated
by `\r\n`, with no checksum (`Scale.writeCommand`). Each command returns the
raw answer (a line terminated by `\n`) or `null` if there is no answer within
`SCALE_RESPONSE_TIMEOUT_MS`.

| Command | Answer | Usage |
|---|---|---|
| `READ` | `ST,GS,     0.0,kg\r\n` | Sent in a loop every `SCALE_READ_INTERVAL_MS`; updates the in-memory reading |
| `ZERO` | any line | Zeroing requested from the frontend (no answer to the frontend) |

`READ` format: `stability,mode,value,units`.
- Stability: `ST` stable, `US` unstable. Sent to the frontend as `status`.
- Mode: `GS` gross, `NT` net. Sent as `mode`.
- `weight` is always the value read.

Commands are queued: there are never two commands awaiting an answer at the
same time. If a command times out, the scale is marked as **not responding**:
the status becomes `no_response` (even if the TCP/serial connection is still
open) and `data` readings stop being emitted until it answers again.

## Structure

```text
src/
├── index.js                 Entry point: http(s).Server + Armari + Socket.IO
├── modules/
│   ├── index.js             Armari: creates the scale and receives socket events
│   ├── Scale.js             Real scale (READ / ZERO)
│   ├── TestScale.js         Simulated scale (MACHINE_MODEL=test)
│   └── protocols/           SerialConnection / SocketConnection
└── socket/                  Socket.IO server
    ├── SocketServer.js      Lifecycle, auth, client limit, emissions
    ├── events.js            Event names, statuses and allowed units
    ├── auth.js              Token validation (timing-safe comparison)
    ├── payloads.js          Payload building and validation
    └── handlers/            Incoming event handlers (ok, error, zero, command)
```

## Requirements and installation

- Node.js 22+ (the Docker image uses the multi-arch `node:22-bookworm`:
  `linux/arm/v7` for RevPi PLC, `linux/amd64` for Windows x64 PCs).

```bash
npm install
```

Configure your `.env` following `.envsample`. Never publish real values.

## Environment variables

### Scale

| Variable | Description |
|---|---|
| `MACHINE_MODEL` | `test` (simulator) or empty (real scale) |
| `BASCULA_ID` / `BASCULA_NAME` | Device identifier and name |
| `BASCULA_UNITS` | Simulator units (the real scale reports them in each `READ`) |
| `DEVICE_IP` / `DEVICE_PORT` | TCP connection to the scale |
| `SERIAL_COM`, `SERIAL_BAUDRATE`, `SERIAL_DATABITS`, `SERIAL_STOPBITS`, `SERIAL_PARITY`, `SERIAL_REGEX` | Serial connection (takes precedence over TCP) |
| `SCALE_READ_INTERVAL_MS` | Interval between `READ` commands (defaults to `SOCKET_DATA_INTERVAL_MS` or 1000) |
| `SCALE_RESPONSE_TIMEOUT_MS` | Max wait for a scale answer (default 2000) |
| `HTTP_PORT` | Local server port (Socket.IO) |
| `DEBUG` | `true` logs every `[WRITE]` command and `[ANSWER]` |

### Socket.IO server

| Variable | Description |
|---|---|
| `DEVICE_SOCKET_TOKEN` | Device token required on every handshake. **If missing, the Socket.IO server does not start.** |
| `SOCKET_ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins. Never `*`. |
| `SOCKET_MAX_CLIENTS` | Simultaneous clients: `1` (Base plan), `2` (Pro), `3` (Enterprise). Default `1`. |
| `SOCKET_DATA_INTERVAL_MS` | Live weight emission interval (ms). Default `1000`. |
| `SSL_KEY_PATH` / `SSL_CERT_PATH` | TLS key/certificate paths. With them the socket is served over **WSS**. |

## Running

| Command | Usage |
|---|---|
| `npm run slave` | Development (nodemon + babel-node, `.env`) |
| `npm run build` | Production build (ncc + babel) |
| `npm run prod` | Production (`node .` on the build) |
| `npm test` | Tests (Jest) |

### Development without hardware (simulated scale)

The native `serialport` bindings are lazy-loaded, so the simulator works on
any development machine:

```bash
MACHINE_MODEL=test BASCULA_ID=scale-1 BASCULA_UNITS=kg HTTP_PORT=3000 \
DEVICE_SOCKET_TOKEN=dev-token SOCKET_ALLOWED_ORIGINS=http://localhost:5173 \
npx babel-node src/index.js
```

In the web application, configure the scale with
`socket_url = http://localhost:3000` and the same token (`dev-token`).

### Several scales in development (docker-compose.dev.yml)

```bash
docker compose -f docker-compose.dev.yml up -d
```

Starts `slave-a` (port **3030**) and `slave-b` (**3031**), both with
`MACHINE_MODEL=test`, the shared `.env` (same `DEVICE_SOCKET_TOKEN`) and data
every 300 ms. In the web application, create two scales with
`socket_url = http://localhost:3030` and `http://localhost:3031` and the same
token. If dependencies change:
`docker compose -f docker-compose.dev.yml down -v` (reinstalls on the next up).

## Socket.IO events

All events require an authenticated connection. An unauthenticated socket is
rejected during the handshake.

### `data` — Local server → Frontend

Latest `READ` reading, emitted every `SOCKET_DATA_INTERVAL_MS` while the scale
is connected and responding.

```json
{
  "id": "scale-1",
  "weight": 12.5,
  "units": "kg",
  "tare": null,
  "net": null,
  "status": "ST",
  "mode": "GS",
  "timestamp": "2026-10-08T08:00:00.000Z"
}
```

Validation: `weight` must be a finite number and `units` must belong to the
closed enum (`mg`, `dg`, `g`, `kg`, `t`, `oz`, `lb`). Readings with an
unsupported unit are discarded and logged (`UNSUPPORTED_WEIGHT_UNIT`).

### `status` — Local server → Frontend

Device status. Emitted on change and to every newly connected client.

```json
{ "status": "connected", "timestamp": "2026-10-08T08:00:00.000Z" }
```

| Value | Meaning |
|---|---|
| `starting` | Starting up |
| `connected` | Interface connected and the scale is responding |
| `disconnected` | Interface (TCP/serial) down |
| `no_response` | Interface connected but the scale does not answer `READ`/`ZERO` |
| `error` | No device configured or internal failure |

### `zero` — Frontend → Local server

The operator requests zeroing. Payload: plain object (`{}`). The `ZERO`
command is sent to the scale; the frontend gets no answer (if the scale does
not answer, the status becomes `no_response`).

### `command` → `command_answer` — Free commands (proxy)

Allows sending **any command** to the scale from the frontend without changing
dtmi4. The server forwards the frame as is and only appends the terminator.
**If the protocol needs a checksum, the client computes it** and includes it
in `command`. The answer is sent **only to the requesting client**.

Frontend → server:

```json
{ "id": "c-42", "command": "READ", "endLine": "\r\n" }
```

| Field | Description |
|---|---|
| `id` | Required. String (max 64) or number; returned as is to match the answer |
| `command` | Required. Full frame (max 256 characters, no `\r` or `\n`) |
| `endLine` | Optional: `"\r\n"` (default), `"\n\r"`, `"\r"`, `"\n"` or `""` |

Server → client:

```json
{ "id": "c-42", "command": "READ", "answer": "ST,GS,     0.0,kg\r\n", "error": null, "timestamp": "..." }
```

`answer` is the raw text received from the scale, up to the `\n`. If there is
no answer, `answer` is `null` and `error` is:

| `error` | Cause |
|---|---|
| `INVALID_PAYLOAD` | Malformed payload |
| `DISCONNECTED` | TCP/serial interface down (nothing is sent) |
| `NO_RESPONSE` | No answer within `SCALE_RESPONSE_TIMEOUT_MS` (the status also becomes `no_response`) |
| `DEVICE_UNAVAILABLE` | No scale configured or internal failure |

Synchronization:
- Commands (free ones and the `READ` loop) go through a **single queue** in
  `Scale`, so there are never two awaiting an answer from the scale and the
  answers never get mixed up.
- The client matches each `command_answer` by its `id`.
- Each command waits for its turn in the queue, so a client with many queued
  commands sees latency increase.

Security: there is no allowlist. Any client authenticated with the token can
send any command to the scale, including configuration or table-write
commands.

### `ok` / `error` — Frontend → Local server

The web application has accepted / rejected a weighing. They are validated
(plain serializable object; if it includes `weight`/`units`, they must match
the enum) and only logged (`Armari.handleOk` / `Armari.handleError`).

Error codes returned by the server:

```text
UNAUTHORIZED             invalid or missing token (handshake)
MAX_CLIENTS_REACHED      plan client limit reached (handshake)
INVALID_PAYLOAD          malformed incoming payload
UNSUPPORTED_WEIGHT_UNIT  unit outside the closed enum
NO_RESPONSE / DISCONNECTED / DEVICE_UNAVAILABLE   only in command_answer
```

## Security

- Token authentication on every handshake (timing-safe comparison). The token
  lives only in `.env`; it is never logged nor sent in the URL.
- Without `DEVICE_SOCKET_TOKEN` the server does not start: there is no
  unauthenticated mode.
- CORS restricted to `SOCKET_ALLOWED_ORIGINS`.
- Use WSS (TLS) in production: browsers block `ws://` from HTTPS frontends.
- Do not expose the port outside the local network without protection.

## Adding a new scale command

To use it from the frontend **there is no need to touch dtmi4**: the
`command` event is enough. Only if dtmi4 must use it on its own (like the
`READ` loop):

1. Add a method in `Scale` that calls `this.writeCommand("CMD")` and processes
   the answer.
2. Add the simulated equivalent in `TestScale`.
3. If the frontend triggers it: name in `SOCKET_EVENTS` (`src/socket/events.js`),
   handler in `src/socket/handlers/`, registration in
   `SocketServer.registerSocketHandlers` and method in `Armari`.
4. Add tests in `src/modules/__tests__/` and `src/socket/__tests__/`.

## Docker deployment (RevPi)

```bash
docker build -t {image}:{version} --platform linux/arm/v7 .
```

```bash
docker run -d \
  --log-opt max-size=10m --log-opt max-file=5 \
  --name dtmi4 \
  --restart always \
  --device=/dev/ttyUSB0:/dev/ttyUSB0 \
  --env-file ./.env \
  --network=host \
  {image}:{version}
```

`--network=host` keeps the Socket.IO server's local port (`HTTP_PORT`)
reachable without extra mappings.

## Deployment on a Windows 10 IoT Enterprise LTSC PC (x64)

There are two options depending on the Docker engine installed on the PC.

### Option A — Linux container (Docker Desktop / Docker on WSL2)

Same image as the RevPi, built for `linux/amd64` (CI publishes it as
`ghcr.io/<repo>:amd64_<tag>`):

```bash
docker build -t {image}:{version} --platform linux/amd64 .
```

```bash
docker run -d --name dtmi4 --restart always \
  --log-opt max-size=10m --log-opt max-file=5 \
  --env-file ./.env -p 3030:3030 \
  {image}:{version}
```

- Use `-p {HTTP_PORT}:{HTTP_PORT}` instead of `--network=host`.
- Scale over TCP (`DEVICE_IP`/`DEVICE_PORT`): works out of the box.
- Scale over a serial port: WSL2 does not see Windows `COMx` ports. Attach
  the USB-serial adapter to WSL2 with
  [usbipd-win](https://github.com/dorssel/usbipd-win)
  (`usbipd bind` + `usbipd attach --wsl`), then use
  `--device=/dev/ttyUSB0` and `SERIAL_COM=/dev/ttyUSB0`.

### Option B — Native Windows container (`Dockerfile.windows`)

For Docker Engine in *Windows containers* mode. It can use Windows `COMx`
ports directly, but **the base image must match the host Windows build**
(process isolation):

| Host | Build | `WINDOWS_VERSION` |
|---|---|---|
| Windows 10 IoT Enterprise LTSC 2019 | 17763 | `ltsc2019` (default) |
| Windows 10 IoT Enterprise LTSC 2021 | 19044 | no 19044 base image exists: use option A |

Check it with `winver` or `[Environment]::OSVersion.Version`. The image is
built on the PC itself (it cannot be built from Linux):

```powershell
docker build -f Dockerfile.windows -t {image}:{version}-win .
```

```powershell
docker run -d --name dtmi4 --restart always `
  --isolation=process `
  --device "class/86E0D1E0-8089-11D0-9CE4-00AA0060FA48" `
  --env-file .\.env -p 3030:3030 `
  {image}:{version}-win
```

- `--device class/86E0D1E0-...` exposes the host COM ports (only with
  `--isolation=process`); in the `.env`, `SERIAL_COM=COM3` (whichever
  applies). If the scale is connected over TCP, `--device` is not needed.
- `NODE_VERSION` (build-arg) pins the Node version; empty = latest 22.x.
