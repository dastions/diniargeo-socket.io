import { EventEmitter } from "events";


class SerialConnection extends EventEmitter {
  constructor(params = {}) {
    super();

    this.options = {
      baudRate: parseInt(params.baudRate || 9600),
      dataBits: parseInt(params.dataBits || 8),
      stopBits: parseInt(params.stopBits || 1),
      parity:   String(params.parity     || 'none')
    }

    this.name   = params.name;
    this.id     = params.id;
    this.com    = params.com || "COM8";
    this.online = false;
    this.buffer = '';

    this.regex  = params.regex || '\r\n';
    
    this.debug  = params.debug;

    this.units  = params.units;
    this.check_data = 0;

    this.errors = 0;

    this.debug && console.log(params);
  }

  init() {
    // Lazy-loaded: serialport ships native bindings that only build on the
    // production device (Node 22 / arm32v7). Loading it here keeps
    // TCP-connected and test scales working on dev machines without the
    // binding.
    const { SerialPort } = require("serialport");
    this.port = new SerialPort({ path: this.com, ...this.options });

    this.port.on("data", (data) => {
      this.online = true;
      this.getData(data.toString("utf8"));

      this.check_data = new Date();
    });

    this.port.on("close", () => {
      this.online = false;
      setTimeout(() => {
        this.connect();
      }, 3e3);
    });

    this.port.on("error", () => {
      this.online = false;
      this.debug && console.log("error connecting Serial!");
      setTimeout(() => {
        this.connect();
      }, 3e3);
    });

    this.port.on('open', () => {
      this.online = true;
      this.emit('open');
    })

    this.clean_buffer = setInterval(
      () => {
        if (this.check_data != 0 && (new Date - this.check_data > 10e3)) {
          this.buffer = "";
          this.check_data = 0;
        }
      }, 1e3);
  }

  write(data) {
    this.port.write(data);
  }

  getData(data) {
    try {
      this.buffer += data;
      let final = this.buffer.match(this.regex);

      if (final) {
        this.emit("data", this.buffer);

        this.buffer = '';
      }
    } catch (e) {
      this.errors += 1;
      this.debug && console.log(e);
      this.debug && console.log("[ERROR] - parse Data");
    }
  }

  close() {
    this.debug && console.log("Close Serial")
    this.port.close();
  }

  connect() {
    try {
      this.debug && console.log("Open Serial")
      this.port.open();
    } catch {
      this.online = false;
    }
  }

  get isConnected() {
    return this.online;
  }

  get configuration() {
    return {
      id: this.id,
      name: this.name,
      com: this.com,
      online: this.online,
      options: this.options,
      regex: this.regex,
      units: this.units,
      errors: this.errors,
      network: this.network,
      hostname: this.hostname,
    };
  }

  onReady(cb) {
    this.on('open', cb);
    return this;
  }

  onDataReceived(cb) {
    this.on("data", cb);
    return this;
  }
}

export default SerialConnection;