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
