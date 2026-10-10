# DTM i4.0 — Aplicación local de báscula (dtmi4-socket)

Aplicación Node.js instalada localmente junto a cada báscula. Lee el peso de
la báscula mediante comandos serie y expone un **servidor Socket.IO** para que
la pantalla del operario de la aplicación web *Batch Control Dosage* reciba el
peso en tiempo real y pueda hacer cero.

```text
Báscula (hardware)
   ↑↓  comandos READ / ZERO  (puerto serie o TCP)
Clase Scale (src/modules/Scale.js)
   ↑↓
Armari (src/modules/index.js)
   ↑↓
Servidor Socket.IO (src/socket/SocketServer.js)
   ↑↓  WS / WSS
Frontend del operario (dosage-frontend)
```

El frontend obtiene `socket_url` y el token del dispositivo desde dosage-api
(`GET /api/scales`, `POST /api/scales/:id/token`) y se conecta directamente
al servidor Socket.IO de esta aplicación.

**La tara es solo del frontend**: la báscula siempre reporta su peso leído y
la aplicación web calcula el neto localmente.

## Modelos (`MACHINE_MODEL`)

| Valor | Dispositivo |
|---|---|
| *(vacío)* | Báscula real: clase `Scale`, comandos `READ` / `ZERO` |
| `test` | Simulador sin interfaz: `READ` devuelve un peso aleatorio y `ZERO` lo pone a cero |

## Comunicación con la báscula (clase `Scale`)

La interfaz se elige según el `.env`: con `SERIAL_COM` se usa
`SerialConnection`; si no, `DEVICE_IP`/`DEVICE_PORT` con `SocketConnection`
(TCP). Sea cual sea la interfaz, la báscula se controla con comandos de texto
terminados en `\r\n`, sin checksum (`Scale.writeCommand`). Cada comando
devuelve la respuesta en crudo (línea terminada en `\n`) o `null` si no hay
respuesta en `SCALE_RESPONSE_TIMEOUT_MS`.

| Comando | Respuesta | Uso |
|---|---|---|
| `READ` | `ST,GS,     0.0,kg\r\n` | Se envía en bucle cada `SCALE_READ_INTERVAL_MS` y actualiza la lectura en memoria |
| `ZERO` | cualquier línea | Puesta a cero solicitada desde el frontend (sin respuesta al frontend) |

Formato de `READ`: `estabilidad,modo,valor,unidades`.
- Estabilidad: `ST` estable, `US` inestable. Se envía al frontend como `status`.
- Modo: `GS` bruto, `NT` neto. Se envía como `mode`.
- `weight` es siempre el valor leído.

Los comandos se encolan: nunca hay dos comandos esperando respuesta a la vez.
Si un comando agota el timeout, la báscula se marca como **sin respuesta**: el
status pasa a `no_response` (aunque la conexión TCP/serie siga abierta) y se
dejan de emitir lecturas `data` hasta que vuelva a responder.

## Estructura

```text
src/
├── index.js                 Punto de entrada: http(s).Server + Armari + Socket.IO
├── modules/
│   ├── index.js             Armari: crea la báscula y recibe los eventos del socket
│   ├── Scale.js             Báscula real (READ / ZERO)
│   ├── TestScale.js         Báscula simulada (MACHINE_MODEL=test)
│   └── protocols/           SerialConnection / SocketConnection
└── socket/                  Servidor Socket.IO
    ├── SocketServer.js      Ciclo de vida, auth, límite de clientes, emisiones
    ├── events.js            Nombres de eventos, estados y unidades permitidas
    ├── auth.js              Validación del token (comparación timing-safe)
    ├── payloads.js          Construcción y validación de payloads
    └── handlers/            Handlers de eventos entrantes (ok, error, zero, command)
```

## Requisitos e instalación

- Node.js 22+ (la imagen Docker de producción usa `arm32v7/node:22-bookworm` para RevPi PLC).

```bash
npm install
```

Configura tu `.env` siguiendo `.envsample`. Nunca publiques valores reales.

## Variables de entorno

### Báscula

| Variable | Descripción |
|---|---|
| `MACHINE_MODEL` | `test` (simulador) o vacío (báscula real) |
| `BASCULA_ID` / `BASCULA_NAME` | Identificador y nombre del dispositivo |
| `BASCULA_UNITS` | Unidad del simulador (la báscula real la reporta en cada `READ`) |
| `DEVICE_IP` / `DEVICE_PORT` | Conexión TCP a la báscula |
| `SERIAL_COM`, `SERIAL_BAUDRATE`, `SERIAL_DATABITS`, `SERIAL_STOPBITS`, `SERIAL_PARITY`, `SERIAL_REGEX` | Conexión serie (tiene prioridad sobre TCP) |
| `SCALE_READ_INTERVAL_MS` | Intervalo entre comandos `READ` (por defecto `SOCKET_DATA_INTERVAL_MS` o 1000) |
| `SCALE_RESPONSE_TIMEOUT_MS` | Espera máxima de respuesta de la báscula (por defecto 2000) |
| `HTTP_PORT` | Puerto del servidor local (Socket.IO) |
| `DEBUG` | `true` registra cada comando `[WRITE]` y respuesta `[ANSWER]` |

### Servidor Socket.IO

| Variable | Descripción |
|---|---|
| `DEVICE_SOCKET_TOKEN` | Token del dispositivo exigido en cada handshake. **Si falta, el servidor Socket.IO no arranca.** |
| `SOCKET_ALLOWED_ORIGINS` | Lista de orígenes CORS permitidos, separados por comas. Nunca `*`. |
| `SOCKET_MAX_CLIENTS` | Clientes simultáneos: `1` (plan Base), `2` (Pro), `3` (Enterprise). Por defecto `1`. |
| `SOCKET_DATA_INTERVAL_MS` | Cadencia de emisión del peso en vivo (ms). Por defecto `1000`. |
| `SSL_KEY_PATH` / `SSL_CERT_PATH` | Rutas de clave/certificado TLS. Con ellas el socket se sirve por **WSS**. |

## Ejecución

| Comando | Uso |
|---|---|
| `npm run slave` | Desarrollo (nodemon + babel-node, `.env`) |
| `npm run build` | Compilación de producción (ncc + babel) |
| `npm run prod` | Producción (`node .` sobre el build) |
| `npm test` | Tests (Jest) |

### Desarrollo sin hardware (báscula simulada)

Los bindings nativos de `serialport` se cargan de forma perezosa, así que el
simulador funciona en cualquier máquina de desarrollo:

```bash
MACHINE_MODEL=test BASCULA_ID=scale-1 BASCULA_UNITS=kg HTTP_PORT=3000 \
DEVICE_SOCKET_TOKEN=dev-token SOCKET_ALLOWED_ORIGINS=http://localhost:5173 \
npx babel-node src/index.js
```

En la aplicación web, configura la báscula con
`socket_url = http://localhost:3000` y el mismo token (`dev-token`).

### Varias balanzas en desarrollo (docker-compose.dev.yml)

```bash
docker compose -f docker-compose.dev.yml up -d
```

Levanta `slave-a` (puerto **3030**) y `slave-b` (**3031**), ambos con
`MACHINE_MODEL=test`, el `.env` compartido (mismo `DEVICE_SOCKET_TOKEN`) y
datos cada 300 ms. En la aplicación web, crea dos básculas con
`socket_url = http://localhost:3030` y `http://localhost:3031` y el mismo
token. Si cambian las dependencias:
`docker compose -f docker-compose.dev.yml down -v` (reinstala al subir).

## Eventos Socket.IO

Todos los eventos exigen conexión autenticada. Un socket sin autenticar se
rechaza en el handshake.

### `data` — Servidor local → Frontend

Última lectura `READ`, emitida cada `SOCKET_DATA_INTERVAL_MS` mientras la
báscula está conectada y respondiendo.

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

Validación: `weight` debe ser un número finito y `units` pertenecer al enum
cerrado (`mg`, `dg`, `g`, `kg`, `t`, `oz`, `lb`). Las lecturas con unidad no
soportada se descartan y se registran (`UNSUPPORTED_WEIGHT_UNIT`).

### `status` — Servidor local → Frontend

Estado del dispositivo. Se emite al cambiar y a cada cliente recién conectado.

```json
{ "status": "connected", "timestamp": "2026-10-08T08:00:00.000Z" }
```

| Valor | Significado |
|---|---|
| `starting` | Arrancando |
| `connected` | Interfaz conectada y la báscula responde |
| `disconnected` | Interfaz (TCP/serie) caída |
| `no_response` | Interfaz conectada pero la báscula no responde a `READ`/`ZERO` |
| `error` | Sin dispositivo configurado o fallo interno |

### `zero` — Frontend → Servidor local

El operario solicita puesta a cero. Payload: objeto plano (`{}`). Se envía el
comando `ZERO` a la báscula; el frontend no recibe respuesta (si la báscula
no contesta, el status pasa a `no_response`).

### `command` → `command_answer` — Comandos libres (proxy)

Permite enviar **cualquier comando** a la báscula desde el frontend sin tocar
dtmi4. El servidor reenvía la trama tal cual y le añade solo el terminador.
**Si el protocolo necesita checksum, lo calcula el cliente** y lo incluye en
`command`. La respuesta se envía **solo al cliente que lo pidió**.

Frontend → servidor:

```json
{ "id": "c-42", "command": "READ", "endLine": "\r\n" }
```

| Campo | Descripción |
|---|---|
| `id` | Obligatorio. String (máx. 64) o número; se devuelve tal cual para emparejar la respuesta |
| `command` | Obligatorio. Trama completa (máx. 256 caracteres, sin `\r` ni `\n`) |
| `endLine` | Opcional: `"\r\n"` (por defecto), `"\n\r"`, `"\r"`, `"\n"` o `""` |

Servidor → cliente:

```json
{ "id": "c-42", "command": "READ", "answer": "ST,GS,     0.0,kg\r\n", "error": null, "timestamp": "..." }
```

`answer` es el texto recibido de la báscula en crudo, hasta el `\n`. Si no
hay respuesta, `answer` es `null` y `error` vale:

| `error` | Causa |
|---|---|
| `INVALID_PAYLOAD` | Payload mal formado |
| `DISCONNECTED` | Interfaz TCP/serie caída (no se envía nada) |
| `NO_RESPONSE` | Sin respuesta en `SCALE_RESPONSE_TIMEOUT_MS` (además el status pasa a `no_response`) |
| `DEVICE_UNAVAILABLE` | Sin báscula configurada o fallo interno |

Sincronización:
- Los comandos (libres y el bucle `READ`) pasan por una **cola única** en
  `Scale`, así que nunca hay dos esperando respuesta en la báscula y las
  respuestas no se mezclan.
- El cliente empareja cada `command_answer` por su `id`.
- Cada comando espera su turno en la cola, así que un cliente con muchos
  comandos encolados ve aumentar la latencia.

Seguridad: no hay lista blanca. Cualquier cliente autenticado con el token
puede enviar cualquier comando a la báscula, incluidos los de configuración o
escritura de tablas.

### `ok` / `error` — Frontend → Servidor local

La aplicación web ha aceptado / rechazado una pesada. Se validan (objeto plano
serializable; si incluye `weight`/`units`, deben ser coherentes con el enum)
y solo se registran en el log (`Armari.handleOk` / `Armari.handleError`).

Códigos de error que responde el servidor:

```text
UNAUTHORIZED             token inválido o ausente (handshake)
MAX_CLIENTS_REACHED      límite de clientes del plan alcanzado (handshake)
INVALID_PAYLOAD          payload entrante mal formado
UNSUPPORTED_WEIGHT_UNIT  unidad fuera del enum cerrado
NO_RESPONSE / DISCONNECTED / DEVICE_UNAVAILABLE   solo en command_answer
```

## Seguridad

- Autenticación por token en cada handshake (comparación timing-safe). El
  token vive solo en `.env`, nunca se registra en logs ni viaja en la URL.
- Sin `DEVICE_SOCKET_TOKEN` el servidor no arranca: no existe modo sin
  autenticación.
- CORS restringido a `SOCKET_ALLOWED_ORIGINS`.
- Usa WSS (TLS) en producción: los navegadores bloquean `ws://` desde
  frontends HTTPS.
- No expongas el puerto fuera de la red local sin protección.

## Añadir un nuevo comando de báscula

Para usarlo desde el frontend **no hace falta tocar dtmi4**: basta con el
evento `command`. Solo si dtmi4 debe usarlo por su cuenta (como el bucle
`READ`):

1. Añade un método en `Scale` que llame a `this.writeCommand("CMD")` y procese
   la respuesta.
2. Añade el equivalente simulado en `TestScale`.
3. Si lo dispara el frontend: nombre en `SOCKET_EVENTS` (`src/socket/events.js`),
   handler en `src/socket/handlers/`, registro en
   `SocketServer.registerSocketHandlers` y método en `Armari`.
4. Añade tests en `src/modules/__tests__/` y `src/socket/__tests__/`.

## Despliegue con Docker (RevPi)

```bash
docker build -t {imagen}:{versión} --platform linux/arm/v7 .
```

```bash
docker run -d \
  --log-opt max-size=10m --log-opt max-file=5 \
  --name dtmi4 \
  --restart always \
  --device=/dev/ttyUSB0:/dev/ttyUSB0 \
  --env-file ./.env \
  --network=host \
  {imagen}:{versión}
```

`--network=host` mantiene accesible el puerto local (`HTTP_PORT`) del
servidor Socket.IO sin mapeos adicionales.
