import { ERROR_CODES, SOCKET_EVENTS } from '../events';
import { validateErrorPayload } from '../payloads';

// Handler for the `error` event (frontend -> server): a weighing/action was
// rejected by the web application. Validates the payload and delivers it to
// the main class without stopping the main process on failures.
export function createErrorHandler(armari, socket) {
  return (payload) => {
    const { valid, error } = validateErrorPayload(payload);

    if (!valid) {
      console.log(`Socket.IO: rejected '${SOCKET_EVENTS.ERROR}' event (${error})`);
      socket.emit(SOCKET_EVENTS.ERROR, { code: error });
      return;
    }

    try {
      armari.handleError(payload);
    } catch (err) {
      console.log(`Socket.IO: '${SOCKET_EVENTS.ERROR}' handler failed (${err.message})`);
      socket.emit(SOCKET_EVENTS.ERROR, { code: ERROR_CODES.INVALID_PAYLOAD });
    }
  };
}
