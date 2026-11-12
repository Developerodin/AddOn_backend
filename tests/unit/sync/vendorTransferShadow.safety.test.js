import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const capture = jest.fn();

jest.unstable_mockModule('../../../src/services/sync/syncShadowCapture.js', () => ({
  captureVendorTransferShadow: (...args) => capture(...args),
  isVendorTransferShadowEnabled: () => true,
}));

const flow = {
  _id: '664f0c2a9b1e4c0012ab34cd',
  currentFloorKey: 'finalChecking',
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  floorQuantities: {
    finalChecking: {
      received: 100,
      completed: 100,
      transferred: 0,
      m1Quantity: 40,
      m1Transferred: 0,
      m2Quantity: 0,
      m2Transferred: 0,
    },
    dispatch: { received: 0, completed: 0, transferred: 0 },
  },
};

const { default: VendorProductionFlow } = await import(
  '../../../src/models/vendorManagement/vendorProductionFlow.model.js'
);
const { transferVendorProductionFlowQuantity } = await import(
  '../../../src/services/vendorManagement/vendorProductionFlow.service.js'
);

describe('vendor transfer when shadow insert throws', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the committed flow and does not add sync fields', async () => {
    capture.mockRejectedValue(new Error('outbox down'));
    jest.spyOn(VendorProductionFlow, 'startSession').mockResolvedValue({
      async withTransaction(fn) {
        return fn();
      },
      endSession() {},
    });
    jest.spyOn(VendorProductionFlow, 'findById').mockImplementation(() => ({ session: async () => flow }));
    jest.spyOn(VendorProductionFlow, 'updateOne').mockResolvedValue({});

    const result = await transferVendorProductionFlowQuantity(flow._id, 'finalChecking', 'dispatch', 10, {});

    expect(VendorProductionFlow.updateOne).toHaveBeenCalled();
    expect(capture).toHaveBeenCalled();
    expect(result).toBe(flow);
    expect(result.vendorTransferContainer).toBeUndefined();
  });
});

describe('sync receivers do not import domain services', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src');
  const files = [
    'controllers/sync.controller.js',
    'services/sync/syncInbox.service.js',
    'services/sync/syncWorker.js',
    'services/sync/syncOwnership.service.js',
  ];

  it('stays off vendor, yarn, order, and warehouse modules', () => {
    const forbidden = /services\/(vendorManagement|yarnManagement|production|whms|order\.service)/;
    files.forEach((rel) => {
      const source = readFileSync(path.join(root, rel), 'utf8');
      expect(source).not.toMatch(forbidden);
    });
  });
});
