import { ERROR_CODES, SOCKET_EVENTS } from '../events';
import { validateCommandPayload, buildCommandAnswerPayload } from '../payloads';

// Handler for the `command` event (frontend -> server): forwards a free
// command to the scale and answers ONLY the requesting client with a
// `command_answer` event carrying the same `id`, so the client can pair
// each answer with its command. Commands are queued in the scale, so
// answers never get mixed between commands (including the READ polling).
export function createCommandHandler(armari, socket) {
  return async (payload) => {
    const reply = (answer, error = null) =>
      socket.emit(SOCKET_EVENTS.COMMAND_ANSWER, buildCommandAnswerPayload(payload, answer, error));

    const { valid, error } = validateCommandPayload(payload);

    if (!valid) {
      console.log(`Socket.IO: rejected '${SOCKET_EVENTS.COMMAND}' event (${error})`);
      return reply(null, error);
    }

    const device = armari?.device;
    if (!device)
      return reply(null, ERROR_CODES.DEVICE_UNAVAILABLE);
    if (!device.isConnected)
      return reply(null, ERROR_CODES.DISCONNECTED);

    try {
      const answer = await armari.handleCommand(payload.command, payload.endLine);

      if (answer == null)
        return reply(null, device.isConnected ? ERROR_CODES.NO_RESPONSE : ERROR_CODES.DISCONNECTED);

      reply(answer);
    } catch (err) {
      console.log(`Socket.IO: '${SOCKET_EVENTS.COMMAND}' handler failed (${err.message})`);
      reply(null, ERROR_CODES.DEVICE_UNAVAILABLE);
    }
  };
}
