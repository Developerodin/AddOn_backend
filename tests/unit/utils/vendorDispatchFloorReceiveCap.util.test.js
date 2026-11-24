import { describe, expect, it } from '@jest/globals';
import { aggregateVendorDispatchFloorReceivedByStyleKey } from '../../../src/utils/vendorDispatchWarehousePending.util.js';

describe('aggregateVendorDispatchFloorReceivedByStyleKey', () => {
  it('excludes warehouse handoff rows from dispatch receive cap totals', () => {
    const rows = [
      {
        receivedStatusFromPreviousFloor: 'Completed',
        styleCode: '699024270d1e1d92d979e6a0',
        brand: 'Van Heusen',
        transferred: 3311,
      },
      {
        receivedStatusFromPreviousFloor: 'warehouse:handoff',
        styleCode: '699024270d1e1d92d979e6a0',
        brand: 'Van Heusen',
        transferred: 1652,
      },
    ];
    const map = aggregateVendorDispatchFloorReceivedByStyleKey(rows);
    const key = '699024270d1e1d92d979e6a0\u0001Van Heusen';
    expect(map.get(key)).toBe(3311);
  });
});