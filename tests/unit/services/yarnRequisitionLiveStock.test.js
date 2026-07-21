/**
 * Mirrors backend live-stock field derivation in getInventoryBreakdownForCatalogIds.
 * @param {object} inv - Raw aggregate row
 * @returns {object}
 */
function deriveLiveStockFromAggregate(inv) {
  const roundKg3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;
  const lt = roundKg3(inv.longTermInventory?.totalNetWeight ?? 0);
  const st = roundKg3(inv.shortTermInventory?.totalNetWeight ?? 0);
  const un = roundKg3(inv.unallocatedInventory?.totalNetWeight ?? 0);
  const blocked = roundKg3(inv.blockedNetWeight ?? 0);
  const totalStock = roundKg3(lt + st);
  const available = roundKg3(Math.max(0, lt + st - blocked));
  return {
    longTermKg: lt,
    shortTermKg: st,
    unallocatedKg: un,
    blockedKg: blocked,
    availableKg: available,
    totalStockKg: totalStock,
  };
}

describe('requisition live stock breakdown', () => {
  test('derives available as LT + ST minus blocked; unallocated excluded from available', () => {
    const live = deriveLiveStockFromAggregate({
      longTermInventory: { totalNetWeight: 100 },
      shortTermInventory: { totalNetWeight: 50 },
      unallocatedInventory: { totalNetWeight: 25 },
      blockedNetWeight: 30,
    });
    expect(live).toEqual({
      longTermKg: 100,
      shortTermKg: 50,
      unallocatedKg: 25,
      blockedKg: 30,
      totalStockKg: 150,
      availableKg: 120,
    });
  });

  test('available never goes below zero', () => {
    const live = deriveLiveStockFromAggregate({
      longTermInventory: { totalNetWeight: 10 },
      shortTermInventory: { totalNetWeight: 5 },
      unallocatedInventory: { totalNetWeight: 0 },
      blockedNetWeight: 20,
    });
    expect(live.availableKg).toBe(0);
    expect(live.totalStockKg).toBe(15);
  });
});
