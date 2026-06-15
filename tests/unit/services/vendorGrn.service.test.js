import { isScReadyForGrn } from '../../../src/services/vendorManagement/vendorGrnScComplete.util.js';

describe('vendorGrn.service isScReadyForGrn', () => {
  test('returns false when no received quantity', () => {
    expect(isScReadyForGrn({ received: 0, pendingFromBoxes: 0 })).toBe(false);
    expect(isScReadyForGrn(null)).toBe(false);
  });

  test('returns false when boxes remain pending (partial scan + full classify)', () => {
    expect(
      isScReadyForGrn({
        received: 60,
        pendingFromBoxes: 144,
        m1Quantity: 50,
        m2Quantity: 5,
        m3Quantity: 3,
        m4Quantity: 2,
        remaining: 0,
      })
    ).toBe(false);
  });

  test('returns false when classification incomplete', () => {
    expect(
      isScReadyForGrn({
        received: 200,
        pendingFromBoxes: 0,
        m1Quantity: 100,
        m2Quantity: 0,
        m3Quantity: 0,
        m4Quantity: 0,
        remaining: 100,
      })
    ).toBe(false);
  });

  test('returns true when all boxes scanned and fully classified', () => {
    expect(
      isScReadyForGrn({
        received: 200,
        pendingFromBoxes: 0,
        m1Quantity: 180,
        m2Quantity: 10,
        m3Quantity: 5,
        m4Quantity: 5,
        remaining: 0,
      })
    ).toBe(true);
  });

  test('derives remaining from M1–M4 when remaining field omitted', () => {
    expect(
      isScReadyForGrn({
        received: 60,
        pendingFromBoxes: 0,
        m1Quantity: 50,
        m2Quantity: 5,
        m3Quantity: 3,
        m4Quantity: 2,
      })
    ).toBe(true);
  });
});
