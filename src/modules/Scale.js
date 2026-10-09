import { EventEmitter } from "events";

import SocketConnection from "./protocols/SocketConnection";
import SerialConnection from "./protocols/SerialConnection";


const DEFAULT_READ_INTERVAL_MS = 1000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 2000;

// Talks to the physical scale through serial text commands, whatever the
// interface (serial port or TCP socket) configured in the .env:
//   READ -> "ST,GS,     0.0,kg\r\n"  (stability, mode, value, units)
//   ZERO -> any answer line
// The last valid reading is kept in memory and exposed through `data` for
// the Socket.IO server.
class Scale extends EventEmitter {
  constructor(params = {}) {
    super();

    this.name  = params.name;
    this.id    = params.id;
    this.debug = !!params.debug;

    this.readIntervalMs = parseInt(params.readIntervalMs) || DEFAULT_READ_INTERVAL_MS;
    this.responseTimeoutMs = parseInt(params.responseTimeoutMs) || DEFAULT_RESPONSE_TIMEOUT_MS;

    this.buffer    = "";
    this.reading   = null;
    this.responding = true;
    this.queue     = Promise.resolve();
    this.readTimer = null;

    this.setInterface(params);

    this.interface.onDataReceived(this.parseData.bind(this));
    this.interface.onReady(() => {
      console.log("Scale interface connected");
      this.buffer = "";
    });
  }

  setInterface(params) {
    if (params.com)
      this.interface = new SerialConnection(params);
    else if (params.ip)
      this.interface = new SocketConnection(params);
    else
      throw new Error('Non <ip> or <com> connection configured on device');
  }

  start() {
    this.interface.init();
    this.readLoop();
  }

  stop() {
    clearTimeout(this.readTimer);
    this.readTimer = null;
  }

  async readLoop() {
    if (this.isConnected)
      await this.read();

    this.readTimer = setTimeout(() => this.readLoop(), this.readIntervalMs);
  }

  get isConnected() {
    return !!this.interface?.isConnected;
  }

  async read() {
    const answer = await this.writeCommand("READ");

    if (answer)
      this.parseReadAnswer(answer);

    return answer;
  }

  // Fire and forget from the frontend point of view; the answer (or its
  // absence) only updates the responding state.
  zero() {
    return this.writeCommand("ZERO");
  }

  parseReadAnswer(answer) {
    const [stable, mode, value, units] = answer.split(',').map((field) => field.trim());
    const weight = parseFloat(value);

    if (!['ST', 'US'].includes(stable) || !['GS', 'NT'].includes(mode) || !isFinite(weight) || !units) {
      console.log("[ERROR] Invalid READ answer: " + JSON.stringify(answer));
      return;
    }

    this.reading = { weight, units, stable, mode };
  }

  parseData(data) {
    try {
      this.buffer += data;

      if (this.buffer[this.buffer.length - 1] === "\n") {
        this.answerReceived(this.buffer);
        this.buffer = "";
      }
    } catch(e) {
      console.log(e)
      console.log("[ERROR] en protocolo de lectura del visor!")
      console.log(data)
    }
  }

  answerReceived(answer) {
    this.debug && console.log("[ANSWER] " + answer);
    this.emit("answer", answer);
  }

  // Commands are queued so an answer is never matched with the wrong command.
  writeCommand(command, endLine = '\r\n') {
    const result = this.queue.then(() => this.sendCommand(command, endLine));
    this.queue = result;
    return result;
  }

  sendCommand(command, endLine) {
    return new Promise((resolve) => {
      if (!this.isConnected) {
        resolve(null);
        return;
      }

      let didResolve = false;

      const startTimeout = setTimeout(() => {
        if (!didResolve) {
          didResolve = true;
          this.removeListener("answer", answerResponse);
          console.log(`[TIMEOUT] ${command}: scale did not answer`);
          this.responding = false;
          resolve(null);
        }
      }, this.responseTimeoutMs);

      const answerResponse = (response) => {
        if (!didResolve) {
          didResolve = true;
          clearTimeout(startTimeout);
          this.responding = true;
          resolve(response);
        }
      };

      this.once("answer", answerResponse);
      this.debug && console.log("[WRITE]" + command);

      try {
        this.interface.write(`${command}${endLine}`);
      } catch (error) {
        didResolve = true;
        clearTimeout(startTimeout);
        this.removeListener("answer", answerResponse);
        console.log(`[ERROR] writing ${command} (${error.message})`);
        resolve(null);
      }
    });
  }

  // Live reading for the Socket.IO `data` event. Null while the scale is
  // disconnected or not answering, so stale weights never reach the frontend.
  get data() {
    if (!this.reading || !this.isConnected || !this.responding)
      return null;

    return {
      id: this.id,
      weight: this.reading.weight,
      units: this.reading.units,
      tare: null,
      net: null,
      status: this.reading.stable,
      mode: this.reading.mode,
    };
  }
}

export default Scale;
