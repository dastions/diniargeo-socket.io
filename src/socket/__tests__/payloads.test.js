import { buildDataPayload, buildStatusPayload, validateOkPayload, validateErrorPayload } from '../payloads';
import { DEVICE_STATUS, ERROR_CODES, WEIGHT_UNITS } from '../events';

describe('payloads', () => {
  describe('buildDataPayload', () => {
    const device = {
      id: 'scale-1',
      status: '3',
      data: { id: 'scale-1', weight: 1000, tare: 10, net: 990, units: 'kg' },
    };

    it('builds a full payload from a valid reading', () => {
      const { payload, error } = buildDataPayload(device);

      expect(error).toBeNull();
      expect(payload).toMatchObject({
        id: 'scale-1',
        weight: 1000,
        units: 'kg',
        tare: 10,
        net: 990,
        status: '3',
      });
      expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
    });

    it('includes the READ mode (GS/NT) and stability flag of the scale', () => {
      const { payload } = buildDataPayload({
        data: { id: 'scale-1', weight: 12.5, units: 'g', tare: null, net: null, status: 'US', mode: 'NT' },
      });
      expect(payload).toMatchObject({ weight: 12.5, units: 'g', tare: null, net: null, status: 'US', mode: 'NT' });
    });

    it('sets mode to null when the device does not report it', () => {
      expect(buildDataPayload(device).payload.mode).toBeNull();
    });

    it.each(WEIGHT_UNITS)('accepts the supported unit %s', (units) => {
      const { payload, error } = buildDataPayload({ data: { weight: 1, units } });
      expect(error).toBeNull();
      expect(payload.units).toBe(units);
    });

    it('rejects unsupported units without building a payload', () => {
      const { payload, error } = buildDataPayload({ data: { weight: 1, units: 'st' } });
      expect(payload).toBeNull();
      expect(error).toBe(ERROR_CODES.UNSUPPORTED_WEIGHT_UNIT);
    });

    it('returns no payload when there is no device or no data', () => {
      expect(buildDataPayload(null).payload).toBeNull();
      expect(buildDataPayload({}).payload).toBeNull();
    });

    it('returns no payload when the weight is not a finite number', () => {
      expect(buildDataPayload({ data: { weight: NaN, units: 'kg' } }).payload).toBeNull();
      expect(buildDataPayload({ data: { weight: '10', units: 'kg' } }).payload).toBeNull();
      expect(buildDataPayload({ data: { units: 'kg' } }).payload).toBeNull();
    });

    it('nullifies invalid tare/net values instead of failing', () => {
      const { payload } = buildDataPayload({ data: { weight: 5, units: 'g', tare: 'x' } });
      expect(payload.tare).toBeNull();
      expect(payload.net).toBeNull();
    });
  });

  describe('buildStatusPayload', () => {
    it.each(Object.values(DEVICE_STATUS))('builds a payload for status %s', (status) => {
      const payload = buildStatusPayload(status);
      expect(payload.status).toBe(status);
      expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
    });

    it('returns null for unknown statuses', () => {
      expect(buildStatusPayload('unstable')).toBeNull();
      expect(buildStatusPayload(undefined)).toBeNull();
    });
  });

  describe.each([
    ['validateOkPayload', validateOkPayload],
    ['validateErrorPayload', validateErrorPayload],
  ])('%s', (_name, validate) => {
    it('accepts a plain serializable object', () => {
      expect(validate({}).valid).toBe(true);
      expect(validate({ weight: 100, units: 'g' }).valid).toBe(true);
    });

    it('rejects non-object payloads', () => {
      expect(validate(null).error).toBe(ERROR_CODES.INVALID_PAYLOAD);
      expect(validate('ok').error).toBe(ERROR_CODES.INVALID_PAYLOAD);
      expect(validate([1, 2]).error).toBe(ERROR_CODES.INVALID_PAYLOAD);
      expect(validate(42).error).toBe(ERROR_CODES.INVALID_PAYLOAD);
    });

    it('rejects unsupported units', () => {
      expect(validate({ units: 'st' }).error).toBe(ERROR_CODES.UNSUPPORTED_WEIGHT_UNIT);
    });

    it('rejects non-numeric weights', () => {
      expect(validate({ weight: 'heavy' }).error).toBe(ERROR_CODES.INVALID_PAYLOAD);
      expect(validate({ weight: Infinity }).error).toBe(ERROR_CODES.INVALID_PAYLOAD);
    });

    it('rejects non-serializable payloads', () => {
      const circular = {};
      circular.self = circular;
      expect(validate(circular).error).toBe(ERROR_CODES.INVALID_PAYLOAD);
    });
  });
});
