import { isTokenConfigured, isValidToken, authMiddleware } from '../auth';
import { ERROR_CODES } from '../events';

const TOKEN = 'test-device-token';

describe('auth', () => {
  afterEach(() => {
    delete process.env.DEVICE_SOCKET_TOKEN;
  });

  describe('isTokenConfigured', () => {
    it('returns false when the variable is missing', () => {
      expect(isTokenConfigured()).toBe(false);
    });

    it('returns false when the variable is empty', () => {
      process.env.DEVICE_SOCKET_TOKEN = '';
      expect(isTokenConfigured()).toBe(false);
    });

    it('returns true when the variable is set', () => {
      process.env.DEVICE_SOCKET_TOKEN = TOKEN;
      expect(isTokenConfigured()).toBe(true);
    });
  });

  describe('isValidToken', () => {
    beforeEach(() => {
      process.env.DEVICE_SOCKET_TOKEN = TOKEN;
    });

    it('accepts the exact configured token', () => {
      expect(isValidToken(TOKEN)).toBe(true);
    });

    it('rejects a wrong token of the same length', () => {
      expect(isValidToken('test-device-tokeX')).toBe(false);
    });

    it('rejects a token of different length', () => {
      expect(isValidToken('short')).toBe(false);
    });

    it('rejects empty and non-string tokens', () => {
      expect(isValidToken('')).toBe(false);
      expect(isValidToken(undefined)).toBe(false);
      expect(isValidToken(null)).toBe(false);
      expect(isValidToken(12345)).toBe(false);
    });

    it('rejects everything when no token is configured', () => {
      delete process.env.DEVICE_SOCKET_TOKEN;
      expect(isValidToken(TOKEN)).toBe(false);
    });
  });

  describe('authMiddleware', () => {
    beforeEach(() => {
      process.env.DEVICE_SOCKET_TOKEN = TOKEN;
    });

    function fakeSocket(token) {
      return { handshake: { auth: { token } } };
    }

    it('accepts a handshake with a valid token', () => {
      const next = jest.fn();
      authMiddleware(fakeSocket(TOKEN), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('rejects a handshake with an invalid token', () => {
      const next = jest.fn();
      authMiddleware(fakeSocket('wrong'), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it('rejects a handshake without auth data', () => {
      const next = jest.fn();
      authMiddleware({ handshake: {} }, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
