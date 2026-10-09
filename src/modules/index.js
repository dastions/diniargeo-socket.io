import Scale     from "./Scale";
import TestScale from "./TestScale";


const MACHINE_MODEL = process.env.MACHINE_MODEL;

// Main class: owns the scale and receives the events delivered by the
// Socket.IO server.
class Armari {
  constructor(params = {}) {
    this.device = null;

    this.initDevice(params.machine);
  }

  initDevice(machine) {
    console.log("Machine Model: " + (MACHINE_MODEL || 'scale'));
    try {
      this.device = MACHINE_MODEL === 'test'
        ? new TestScale(machine)
        : new Scale(machine);

      this.device.start();
    } catch (error) {
      console.log(error);
    }
  }

  // The web application accepted a weighing. Log only.
  handleOk(payload) {
    console.log("Socket.IO 'ok' received");
    console.log(payload);
  }

  // The web application rejected a weighing. Log only.
  handleError(payload) {
    console.log("Socket.IO 'error' received");
    console.log(payload);
  }

  // Operator asks the scale to zero. The frontend does not wait for an
  // answer; a missing answer surfaces as the `no_response` status.
  handleZero() {
    console.log("Socket.IO 'zero' received");
    this.device?.zero();
  }

  // Free command from the frontend (proxy): the frame is sent as is (the
  // client adds any checksum) plus the line terminator. Resolves with the
  // raw answer of the scale, or null when it does not answer.
  handleCommand(command, endLine) {
    console.log(`Socket.IO 'command' received: ${JSON.stringify(command)}`);
    return this.device.writeCommand(command, endLine);
  }
}

export default Armari;
