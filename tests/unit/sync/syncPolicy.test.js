import { checkEventPolicy } from '../../../src/services/sync/syncPolicy.js';

const base = {
  siteId: 'factory-a',
  entityType: 'vendorProductionFlow',
  payload: { flowId: 'f1', fromFloorKey: 'branding', toFloorKey: 'finalChecking', quantity: 10, containerBarcode: null },
};

describe('sync policy', () => {
  it('accepts a vendor transfer delta', () => {
    expect(checkEventPolicy(base, 'factory-a')).toBeNull();
  });

  it('rejects derived counters', () => {
    const result = checkEventPolicy({ ...base, payload: { producedQty: 3 } }, 'factory-a');
    expect(result.code).toBe('DERIVED_FIELD_NOT_ALLOWED');
  });

  it('rejects report entities', () => {
    const result = checkEventPolicy({ ...base, entityType: 'floorReport' }, 'factory-a');
    expect(result.code).toBe('REPORT_ENTITY_NOT_SYNCABLE');
  });
});
