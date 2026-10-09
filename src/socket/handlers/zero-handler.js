import { ERROR_CODES, SOCKET_EVENTS } from '../events';
import { validateOkPayload } from '../payloads';

// Handler for the `zero` event (frontend -> server): the operator asks the
// scale to zero. The main class sends the ZERO command; no answer is sent
// back to the frontend (a silent scale surfaces as the `no_response` status).
export function createZeroHandler(armari, socket) {
  return (payload = {}) => {
    const { valid, error } = validateOkPayload(payload);

    if (!valid) {
      console.log(`Socket.IO: rejected '${SOCKET_EVENTS.ZERO}' event (${error})`);
      socket.emit(SOCKET_EVENTS.ERROR, { code: error });
      return;
    }

    try {
      armari.handleZero(payload);
    } catch (err) {
      console.log(`Socket.IO: '${SOCKET_EVENTS.ZERO}' handler failed (${err.message})`);
      socket.emit(SOCKET_EVENTS.ERROR, { code: ERROR_CODES.INVALID_PAYLOAD });
    }
  };
}
