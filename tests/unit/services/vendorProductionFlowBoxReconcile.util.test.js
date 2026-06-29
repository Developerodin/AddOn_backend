import ApiError from '../../../src/utils/ApiError.js';
import {
  assertSaneBoxUnitQty,
  MAX_VENDOR_BOX_UNIT_SYNC,
  sumBoxUnitsForSecondaryChecking,
} from '../../../src/services/vendorManagement/vendorProductionFlowBoxReconcile.util.js';

describe('vendorProductionFlowBoxReconcile.util', () => {
  describe('assertSaneBoxUnitQty', () => {
    test('accepts normal box quantities', () => {
      expect(assertSaneBoxUnitQty(576)).toBe(576);
      expect(assertSaneBoxUnitQty('1000')).toBe(1000);
    });

    test('rejects absurd quantities such as scanned barcodes', () => {
      expect(() => assertSaneBoxUnitQty(636177261488)).toThrow(ApiError);
      expect(() => assertSaneBoxUnitQty(636177261488)).toThrow(/maximum allowed per box/);
    });

    test('rejects non-positive values', () => {
      expect(() => assertSaneBoxUnitQty(0)).toThrow(ApiError);
      expect(() => assertSaneBoxUnitQty(-5)).toThrow(ApiError);
    });
  });

  describe('sumBoxUnitsForSecondaryChecking', () => {
    test('sums planned, received, and pending from boxes', () => {
      const totals = sumBoxUnitsForSecondaryChecking([
        { numberOfUnits: 576, secondaryCheckingAccepted: true },
        { numberOfUnits: 1000, secondaryCheckingAccepted: true },
        { numberOfUnits: 50, secondaryCheckingAccepted: false },
      ]);
      expect(totals).toEqual({ planned: 1626, received: 1576, pending: 50 });
    });

    test('treats invalid units as zero', () => {
      const totals = sumBoxUnitsForSecondaryChecking([
        { numberOfUnits: 'abc', secondaryCheckingAccepted: true },
        { numberOfUnits: 7, secondaryCheckingAccepted: true },
      ]);
      expect(totals).toEqual({ planned: 7, received: 7, pending: 0 });
    });
  });

  test('MAX_VENDOR_BOX_UNIT_SYNC is a reasonable ceiling', () => {
    expect(MAX_VENDOR_BOX_UNIT_SYNC).toBeGreaterThan(1000);
    expect(MAX_VENDOR_BOX_UNIT_SYNC).toBeLessThan(636177261488);
  });
});
