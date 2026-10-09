import net from "net";
import { EventEmitter } from "events";


class SocketConnection extends EventEmitter {
  constructor(params) {
    super();

    this.name = params.name || "connection";

    this.IP = params.ip || "192.168.5.105";
    this.PORT = params.port || 4001;

    this.debug = !!params.debug;
    this.TCP_RECONNECT_TIMEOUT = 5e3;

    this.socket = null;

    this.isConnected = false;
  }

  init() {
    this.socket = new net.Socket();

    this.socket.connect({ host: this.IP, port: this.PORT });
    this.socket.setKeepAlive(true);

    // On connect handler
    this.socket.on("connect", () => {
      this.isConnected = true;
      this.debug && console.log(`Socket Connected! (${this.IP}:${this.PORT})`);
      this.emit("ready");
    });
    // On end handler
    this.socket.on("end", () => {
      this.isConnected = false;
      this.debug && console.log(`Socket connection Ended`);
    });
    // On ready handler
    this.socket.on("ready", () => {
      this.debug && console.log(`Socket connection is Ready`);
    });
    // On close handler
    this.socket.on("close", () => {
      this.isConnected = false;
      this.debug && console.log(`Socket connection Closed`);
      setTimeout(() => {
        this.removeSocket();
        this.init();
      }, this.TCP_RECONNECT_TIMEOUT);
    });
    // On error handler
    this.socket.on("error", (error) => {
      this.debug &&
        console.log(`Socket connection got an Error (${error.message})`);
    });
    // On data handler
    this.socket.on("data", (data) => {
      this.emit("data", data.toString("utf-8"));
    });
  }

  set configuration(configuration = {}) {
    try {
      this.removeSocket();
      configuration.ip && (this.IP = configuration.ip);
      configuration.port && (this.PORT = configuration.port);
      configuration.name && (this.name = configuration.name);

      setTimeout(() => {
        this.init();
      }, 1e3);
    } catch {
    } finally {
      try {
        if (SocketConnection.writeFile) {
          // If can persist data
          SocketConnection.writeFile();
        }
      } catch {}
    }
  }

  get configuration() {
    return {
      name: this.name,
      ip: this.IP,
      port: this.PORT,
      online: this.isConnected,
    };
  }

  write(data) {
    if (this.socket && this.isConnected) {
      this.socket.write(data);
    } else {
      this.debug && console.log(`Socket is not connected`);
    }
  }

  removeSocket() {
    this.socket.removeAllListeners();
    this.socket.end();
    this.socket = null;
  }

  onDataReceived(cb) {
    this.on("data", cb);
    return this;
  }

  onReady(cb) {
    this.on("ready", cb);
    return this;
  }
}

export default SocketConnection;
