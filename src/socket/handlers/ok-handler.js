import { ERROR_CODES, SOCKET_EVENTS } from '../events';
import { validateOkPayload } from '../payloads';

// Handler for the `ok` event (frontend -> server): a weighing/action was
// accepted by the web application. Validates the payload and delivers it
// to the main class; Socket.IO stays decoupled from device logic.
export function createOkHandler(armari, socket) {
  return (payload) => {
    const { valid, error } = validateOkPayload(payload);

    if (!valid) {
      console.log(`Socket.IO: rejected '${SOCKET_EVENTS.OK}' event (${error})`);
      socket.emit(SOCKET_EVENTS.ERROR, { code: error });
      return;
    }

    try {
      armari.handleOk(payload);
    } catch (err) {
      console.log(`Socket.IO: '${SOCKET_EVENTS.OK}' handler failed (${err.message})`);
      socket.emit(SOCKET_EVENTS.ERROR, { code: ERROR_CODES.INVALID_PAYLOAD });
    }
  };
}
