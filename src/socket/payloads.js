import { DEVICE_STATUS, ERROR_CODES, isSupportedWeightUnit } from './events';

// Payload builders and validators for every Socket.IO event.
// Outgoing payloads are built here so the event contract lives in a
// single place; incoming payloads are validated here before they reach
// the main class.

// DataPayload (server -> frontend). Returns null when the device has no
// valid reading, so the caller can skip the emission.
export function buildDataPayload(device) {
  if (!device || !device.data)
    return { payload: null, error: null };

  const { id, weight, tare, net, units, status, mode } = device.data;

  if (typeof weight !== 'number' || !isFinite(weight))
    return { payload: null, error: null };

  if (!isSupportedWeightUnit(units))
    return { payload: null, error: ERROR_CODES.UNSUPPORTED_WEIGHT_UNIT };

  return {
    payload: {
      id: id ?? device.id ?? null,
      weight,
      units,
      tare: typeof tare === 'number' && isFinite(tare) ? tare : null,
      net: typeof net === 'number' && isFinite(net) ? net : null,
      status: status ?? device.status ?? null,
      mode: mode ?? null,
      timestamp: new Date().toISOString(),
    },
    error: null,
  };
}

// StatusPayload (server -> frontend).
export function buildStatusPayload(status) {
  if (!Object.values(DEVICE_STATUS).includes(status))
    return null;

  return {
    status,
    timestamp: new Date().toISOString(),
  };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// OkPayload / ErrorPayload (frontend -> server). The concrete business
// fields will be defined by the upcoming specification; until then the
// contract requires a serializable plain object, and any weight/units
// fields it carries must be coherent with the closed unit enum.
function validateIncomingPayload(payload) {
  if (!isPlainObject(payload))
    return { valid: false, error: ERROR_CODES.INVALID_PAYLOAD };

  if ('units' in payload && !isSupportedWeightUnit(payload.units))
    return { valid: false, error: ERROR_CODES.UNSUPPORTED_WEIGHT_UNIT };

  if ('weight' in payload && (typeof payload.weight !== 'number' || !isFinite(payload.weight)))
    return { valid: false, error: ERROR_CODES.INVALID_PAYLOAD };

  try {
    JSON.stringify(payload);
  } catch {
    return { valid: false, error: ERROR_CODES.INVALID_PAYLOAD };
  }

  return { valid: true, error: null };
}

export function validateOkPayload(payload) {
  return validateIncomingPayload(payload);
}

export function validateErrorPayload(payload) {
  return validateIncomingPayload(payload);
}

// CommandPayload (frontend -> server): a free command forwarded to the
// scale. The client sends the complete frame (checksum included, if the
// protocol needs one); the server only appends the line terminator.
export const COMMAND_MAX_LENGTH = 256;
export const COMMAND_ID_MAX_LENGTH = 64;
export const COMMAND_END_LINES = ['\r\n', '\r', '\n', ''];

export function validateCommandPayload(payload) {
  if (!isPlainObject(payload))
    return { valid: false, error: ERROR_CODES.INVALID_PAYLOAD };

  const { id, command, endLine } = payload;

  const validId = (typeof id === 'string' && id.length > 0 && id.length <= COMMAND_ID_MAX_LENGTH)
    || (typeof id === 'number' && Number.isFinite(id));
  if (!validId)
    return { valid: false, error: ERROR_CODES.INVALID_PAYLOAD };

  // Line breaks would split the frame into several commands and break the
  // one-command / one-answer pairing.
  if (typeof command !== 'string' || command.length === 0
      || command.length > COMMAND_MAX_LENGTH || /[\r\n]/.test(command))
    return { valid: false, error: ERROR_CODES.INVALID_PAYLOAD };

  if (endLine !== undefined && !COMMAND_END_LINES.includes(endLine))
    return { valid: false, error: ERROR_CODES.INVALID_PAYLOAD };

  return { valid: true, error: null };
}

// CommandAnswerPayload (server -> requesting client only). `answer` is the
// raw text received from the scale, or null with an error code.
export function buildCommandAnswerPayload(payload, answer, error = null) {
  return {
    id: isPlainObject(payload) ? payload.id ?? null : null,
    command: isPlainObject(payload) && typeof payload.command === 'string' ? payload.command : null,
    answer: answer ?? null,
    error,
    timestamp: new Date().toISOString(),
  };
}
