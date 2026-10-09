import Scale from '../Scale';
import TestScale from '../TestScale';
import SocketConnection from '../protocols/SocketConnection';
import SerialConnection from '../protocols/SerialConnection';

// Fake interface: records what is written and lets the test answer as the
// scale would through Scale.parseData.
function createScale(params = {}) {
  const scale = new Scale({ id: 'scale-1', ip: '127.0.0.1', port: 4001, responseTimeoutMs: 50, ...params });
  scale.interface = { isConnected: true, write: jest.fn() };
  return scale;
}

function nextTick() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('Scale', () => {
  it('selects the interface from the .env configuration', () => {
    expect(new Scale({ ip: '127.0.0.1' }).interface).toBeInstanceOf(SocketConnection);
    expect(new Scale({ com: '/dev/ttyUSB0' }).interface).toBeInstanceOf(SerialConnection);
    expect(() => new Scale({})).toThrow(/Non <ip> or <com>/);
  });

  it('writes READ with the CRLF terminator and parses a gross stable answer', async () => {
    const scale = createScale();

    const pending = scale.read();
    await nextTick();
    expect(scale.interface.write).toHaveBeenCalledWith('READ\r\n');

    scale.parseData('ST,GS,     0.0,kg\r\n');
    await expect(pending).resolves.toBe('ST,GS,     0.0,kg\r\n');

    expect(scale.data).toEqual({
      id: 'scale-1', weight: 0, units: 'kg', tare: null, net: null, status: 'ST', mode: 'GS',
    });
  });

  it('parses unstable / net answers received in several chunks', async () => {
    const scale = createScale();

    const pending = scale.read();
    await nextTick();
    scale.parseData('US,NT,  ');
    scale.parseData(' 12.5,g\r');
    scale.parseData('\n');
    await pending;

    expect(scale.data).toMatchObject({ weight: 12.5, units: 'g', status: 'US', mode: 'NT' });
  });

  it('keeps the previous reading when the READ answer is malformed', async () => {
    const scale = createScale();
    scale.reading = { weight: 3, units: 'kg', stable: 'ST', mode: 'GS' };

    const pending = scale.read();
    await nextTick();
    scale.parseData('garbage\r\n');
    await pending;

    expect(scale.data.weight).toBe(3);
  });

  it('writes ZERO and returns the raw answer', async () => {
    const scale = createScale();

    const pending = scale.zero();
    await nextTick();
    expect(scale.interface.write).toHaveBeenCalledWith('ZERO\r\n');

    scale.parseData('OK\r\n');
    await expect(pending).resolves.toBe('OK\r\n');
    expect(scale.responding).toBe(true);
  });

  it('marks the scale as not responding on timeout and hides the reading', async () => {
    const scale = createScale();
    scale.reading = { weight: 3, units: 'kg', stable: 'ST', mode: 'GS' };

    await expect(scale.read()).resolves.toBeNull();

    expect(scale.responding).toBe(false);
    expect(scale.data).toBeNull();

    const pending = scale.read();
    await nextTick();
    scale.parseData('ST,GS,1.5,kg\r\n');
    await pending;

    expect(scale.responding).toBe(true);
    expect(scale.data.weight).toBe(1.5);
  });

  it('queues commands so each answer matches its own command', async () => {
    const scale = createScale();

    const zero = scale.zero();
    const read = scale.read();
    await nextTick();
    expect(scale.interface.write).toHaveBeenCalledTimes(1);
    expect(scale.interface.write).toHaveBeenLastCalledWith('ZERO\r\n');

    scale.parseData('OK\r\n');
    await expect(zero).resolves.toBe('OK\r\n');
    await nextTick();
    expect(scale.interface.write).toHaveBeenLastCalledWith('READ\r\n');

    scale.parseData('ST,GS,0.0,kg\r\n');
    await expect(read).resolves.toBe('ST,GS,0.0,kg\r\n');
  });

  it('does not write while the interface is disconnected', async () => {
    const scale = createScale();
    scale.interface.isConnected = false;

    await expect(scale.read()).resolves.toBeNull();

    expect(scale.interface.write).not.toHaveBeenCalled();
    expect(scale.responding).toBe(true);
    expect(scale.data).toBeNull();
  });
});

describe('TestScale', () => {
  it('returns a random weight on READ without any interface', async () => {
    const scale = new TestScale({ id: 'test', units: 'kg' });

    const answer = await scale.read();

    expect(scale.interface).toBeUndefined();
    expect(answer).toMatch(/^(ST|US),GS,[\d.]+,kg\r\n$/);
    expect(scale.data).toMatchObject({ id: 'test', units: 'kg', mode: 'GS' });
    expect(scale.isConnected).toBe(true);
  });

  it('sets the weight to zero on ZERO', async () => {
    const scale = new TestScale({ id: 'test', units: 'kg' });
    scale.raw = 5;
    await scale.read();

    await scale.zero();

    expect(scale.data.weight).toBe(0);
    await scale.read();
    expect(Math.abs(scale.data.weight)).toBeLessThanOrEqual(0.05);
  });
});
