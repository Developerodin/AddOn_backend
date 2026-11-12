import { jest } from '@jest/globals';

const create = jest.fn();
const nextCounterValue = jest.fn();

jest.unstable_mockModule('../../../src/models/sync/syncOutbox.model.js', () => ({
  default: { create },
}));

jest.unstable_mockModule('../../../src/services/sync/syncCounter.service.js', () => ({
  nextCounterValue: (...args) => nextCounterValue(...args),
  aggregateVersionKey: (entityType, aggregateId) => `${entityType}:${aggregateId}`,
  siteSequenceKey: (siteId) => `site:${siteId}`,
}));

const { captureVendorTransferShadow } = await import('../../../src/services/sync/syncShadowCapture.js');
const { default: config } = await import('../../../src/config/config.js');

const delta = {
  flowId: '664f0c2a9b1e4c0012ab34cd',
  fromFloorKey: 'branding',
  toFloorKey: 'finalChecking',
  quantity: 12,
  containerBarcode: null,
};

describe('captureVendorTransferShadow', () => {
  const original = { ...config.sync };

  beforeEach(() => {
    create.mockReset();
    nextCounterValue.mockReset();
    nextCounterValue.mockResolvedValueOnce(1).mockResolvedValueOnce(4);
    Object.assign(config.sync, {
      enabled: true,
      shadowVendorTransfer: true,
      applyPilot: false,
      siteId: 'factory-a',
      factorySiteId: 'factory-mac',
    });
  });

  afterAll(() => {
    Object.assign(config.sync, original);
  });

  it('writes nothing when the flags are off', async () => {
    config.sync.enabled = false;
    await expect(captureVendorTransferShadow(delta)).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('skips when the site id is empty', async () => {
    config.sync.siteId = '';
    await expect(captureVendorTransferShadow(delta)).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('stores a delta with occurredAt and no floor quantities', async () => {
    create.mockResolvedValue({ id: 'row' });
    await captureVendorTransferShadow(delta);
    expect(create).toHaveBeenCalledTimes(1);
    const event = create.mock.calls[0][0];
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event.payload).toEqual({
      flowId: delta.flowId,
      fromFloorKey: 'branding',
      toFloorKey: 'finalChecking',
      quantity: 12,
      containerBarcode: null,
    });
    expect(event.payload.floorQuantities).toBeUndefined();
    expect(event.origin).toBe('user');
  });

  it('with pilot apply on, the cloud does not publish vendor transfers', async () => {
    Object.assign(config.sync, { applyPilot: true, siteId: 'cloud-mac' });
    await expect(captureVendorTransferShadow(delta)).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('with pilot apply on, the factory still publishes', async () => {
    create.mockResolvedValue({ id: 'row' });
    Object.assign(config.sync, { applyPilot: true, siteId: 'factory-mac' });
    await captureVendorTransferShadow(delta);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not capture while a peer event is being applied', async () => {
    const { runAsSyncApply } = await import('../../../src/services/sync/syncPilotCapture.js');
    await expect(runAsSyncApply(() => captureVendorTransferShadow(delta))).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('throws when the insert fails so the floor caller can swallow it', async () => {
    create.mockRejectedValue(new Error('duplicate'));
    await expect(captureVendorTransferShadow(delta)).rejects.toThrow('duplicate');
  });
});
