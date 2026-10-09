import { EventEmitter } from "events";


const DEFAULT_READ_INTERVAL_MS = 1000;
const MAX_STEP = 0.05;

// Simulated scale (MACHINE_MODEL=test): same public API as Scale but
// without any interface. READ returns a random weight and ZERO sets the
// current weight to zero.
class TestScale extends EventEmitter {
  constructor(params = {}) {
    super();

    this.name  = params.name;
    this.id    = params.id;
    this.units = params.units || 'kg';

    this.readIntervalMs = parseInt(params.readIntervalMs) || DEFAULT_READ_INTERVAL_MS;

    this.raw        = Math.random() * 10;
    this.offset     = 0;
    this.reading    = null;
    this.responding = true;
    this.readTimer  = null;
  }

  start() {
    this.read();
    this.readTimer = setInterval(() => this.read(), this.readIntervalMs);
  }

  stop() {
    clearInterval(this.readTimer);
    this.readTimer = null;
  }

  get isConnected() {
    return true;
  }

  read() {
    this.raw = Math.max(0, this.raw + (Math.random() * 2 - 1) * MAX_STEP);

    const weight = Math.round((this.raw - this.offset) * 1000) / 1000;
    const stable = Math.random() > 0.2 ? 'ST' : 'US';

    this.reading = { weight, units: this.units, stable, mode: 'GS' };

    return Promise.resolve(`${stable},GS,${weight},${this.units}\r\n`);
  }

  zero() {
    this.offset = this.raw;
    this.reading = { ...this.reading, weight: 0 };

    return Promise.resolve("OK\r\n");
  }

  // Free commands (simulated): READ and ZERO behave as on the real scale;
  // any other command answers "ERR".
  writeCommand(command) {
    if (command === 'READ')
      return this.read();
    if (command === 'ZERO')
      return this.zero();

    return Promise.resolve("ERR\r\n");
  }

  get data() {
    if (!this.reading)
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

export default TestScale;
