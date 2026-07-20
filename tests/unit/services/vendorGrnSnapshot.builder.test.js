import {
  buildSnapshotFromFlow,
  collectLotNumbers,
} from '../../../src/services/vendorManagement/vendorGrnSnapshot.builder.js';

describe('vendorGrnSnapshot.builder invoice grouping', () => {
  const vpo = {
    _id: 'vpo1',
    vpoNumber: 'VPO-1',
    poItems: [{ _id: 'poItem1', productId: 'prodA' }],
    receivedLotDetails: [
      {
        lotNumber: 'INV-001',
        numberOfBoxes: 2,
        totalUnits: 100,
        poItems: [{ poItem: 'poItem1', receivedQuantity: 100 }],
      },
      {
        lotNumber: 'INV-002',
        numberOfBoxes: 1,
        totalUnits: 50,
        poItems: [{ poItem: 'poItem1', receivedQuantity: 50 }],
      },
    ],
  };

  const baseFlow = {
    _id: 'flow1',
    product: { _id: 'prodA', name: 'Shirt', vendorCode: 'SH1' },
    floorQuantities: {
      secondaryChecking: {
        received: 150,
        m1Quantity: 140,
        m2Quantity: 5,
        m3Quantity: 3,
        vm4Quantity: 2,
        receivedData: [{ lotNumber: 'INV-001' }, { lotNumber: 'INV-002' }],
      },
    },
  };

  test('collectLotNumbers unions receivedData and accepted boxes', () => {
    const lots = collectLotNumbers(baseFlow, [
      { lotNumber: 'INV-001', numberOfUnits: 100 },
      { lotNumber: 'INV-002', numberOfUnits: 50 },
    ]);
    expect(lots.sort()).toEqual(['INV-001', 'INV-002']);
  });

  test('lotNumberFilter restricts snapshot to one invoice', () => {
    const snap = buildSnapshotFromFlow({
      flow: baseFlow,
      vpo,
      boxes: [
        { lotNumber: 'INV-001', numberOfUnits: 100, boxId: 'B1' },
        { lotNumber: 'INV-002', numberOfUnits: 50, boxId: 'B2' },
      ],
      lotNumberFilter: 'INV-001',
    });

    expect(snap.lots).toHaveLength(1);
    expect(snap.lots[0].lotNumber).toBe('INV-001');
    expect(snap.lots[0].items[0].expectedQty).toBe(100);
    expect(snap.totals.verified).toBeGreaterThan(0);
    expect(snap.totals.verified).toBeLessThan(150);
  });
});
