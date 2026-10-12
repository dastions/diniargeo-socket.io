import Armari, { RELEASE_COMMANDS } from '../index';

// Armari with a fake device: the constructor cannot create a real Scale
// without <ip>/<com>, so the device is injected afterwards.
function createArmari() {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  const armari = new Armari({ machine: {} });
  armari.device = {
    startReading: jest.fn(),
    stopReading: jest.fn(),
    writeCommand: jest.fn(async () => 'OK\r\n'),
  };
  return armari;
}

describe('Armari client lifecycle', () => {
  afterEach(() => jest.restoreAllMocks());

  it('starts the READ loop when the first client connects', () => {
    const armari = createArmari();

    armari.handleClientConnected();

    expect(armari.device.startReading).toHaveBeenCalledTimes(1);
  });

  it('stops the READ loop and switches every output off when no clients are left', async () => {
    const armari = createArmari();

    await armari.handleClientsDisconnected();

    expect(RELEASE_COMMANDS).toEqual(['OUTP00000']);
    expect(armari.device.stopReading).toHaveBeenCalledTimes(1);
    expect(armari.device.writeCommand.mock.calls).toEqual([['OUTP00000']]);
  });

  it('does not fail without a device', async () => {
    const armari = createArmari();
    armari.device = null;

    expect(() => armari.handleClientConnected()).not.toThrow();
    await expect(armari.handleClientsDisconnected()).resolves.toBeUndefined();
  });
});
