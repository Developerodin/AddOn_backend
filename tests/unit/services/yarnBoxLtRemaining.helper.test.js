import {
  computeLtRemainingBoxWeight,
  expectedYarnBoxConeCount,
  isCartonEmptyByMovedCount,
  LT_TRANSFER_HUMIDITY_BUFFER_FRACTION,
} from '../../../src/services/yarnManagement/yarnBoxLtRemaining.helper.js';

describe('computeLtRemainingBoxWeight humidity buffer', () => {
  const box30 = {
    initialBoxWeight: 30,
    boxWeight: 30,
    numberOfCones: 30,
  };

  /**
   * @param {number} count
   * @param {number} eachKg
   */
  const cones = (count, eachKg) => Array.from({ length: count }, () => ({ coneWeight: eachKg }));

  test('buffer is 15%', () => {
    expect(LT_TRANSFER_HUMIDITY_BUFFER_FRACTION).toBe(0.15);
  });

  test('30 cones at 1kg each: exact match, leave LT', () => {
    const r = computeLtRemainingBoxWeight(box30, cones(30, 1), []);
    expect(r.remaining).toBe(0);
    expect(r.fullyTransferred).toBe(true);
    expect(r.persistBoxWeight).toBe(0);
  });

  test('30 cones totaling 29kg: humidity leftover, leave LT', () => {
    const r = computeLtRemainingBoxWeight(box30, cones(30, 29 / 30), []);
    expect(r.remaining).toBeCloseTo(1, 6);
    expect(r.humidityLimitKg).toBeCloseTo(4.5, 6);
    expect(r.fullyTransferred).toBe(true);
    expect(r.persistBoxWeight).toBe(0);
  });

  test('30 cones totaling 28kg: humidity leftover, leave LT', () => {
    const r = computeLtRemainingBoxWeight(box30, cones(30, 28 / 30), []);
    expect(r.remaining).toBeCloseTo(2, 6);
    expect(r.fullyTransferred).toBe(true);
    expect(r.persistBoxWeight).toBe(0);
  });

  test('30 cones totaling 25kg: leftover 5kg > 15% but all cones moved, empty carton', () => {
    const r = computeLtRemainingBoxWeight(box30, cones(30, 25 / 30), []);
    expect(r.remaining).toBeCloseTo(5, 6);
    expect(r.fullyTransferred).toBe(true);
    expect(r.persistBoxWeight).toBe(0);
  });

  test('15 cones totaling 28kg: partial move, stay on LT even inside 15%', () => {
    const r = computeLtRemainingBoxWeight(box30, cones(15, 28 / 15), []);
    expect(r.remaining).toBeCloseTo(2, 6);
    expect(r.fullyTransferred).toBe(false);
    expect(r.persistBoxWeight).toBeCloseTo(2, 6);
  });

  test('boundary: leftover exactly 15% of 30kg (4.5) with all cones moved, leave LT', () => {
    const r = computeLtRemainingBoxWeight(box30, cones(30, 25.5 / 30), []);
    expect(r.remaining).toBeCloseTo(4.5, 6);
    expect(r.fullyTransferred).toBe(true);
    expect(r.persistBoxWeight).toBe(0);
  });

  test('7 expected, 4 ST leftover + movedCount 7 (used cones): empty carton', () => {
    const box = { initialBoxWeight: 0.45, boxWeight: 0.048, numberOfCones: 7 };
    const st = [
      { coneWeight: 0.08 },
      { coneWeight: 0.078 },
      { coneWeight: 0.084 },
      { coneWeight: 0.08 },
    ];
    const r = computeLtRemainingBoxWeight(box, st, [], { movedConeCount: 7 });
    expect(r.remaining).toBeCloseTo(0.128, 6);
    expect(r.fullyTransferred).toBe(true);
    expect(r.persistBoxWeight).toBe(0);
  });

  test('7 expected, 4 ST only: partial, keep remaining', () => {
    const box = { initialBoxWeight: 0.45, boxWeight: 0.45, numberOfCones: 7 };
    const st = [
      { coneWeight: 0.08 },
      { coneWeight: 0.078 },
      { coneWeight: 0.084 },
      { coneWeight: 0.08 },
    ];
    const r = computeLtRemainingBoxWeight(box, st, []);
    expect(r.fullyTransferred).toBe(false);
    expect(r.persistBoxWeight).toBeCloseTo(0.128, 6);
  });

  test('missing expected count, leftover within 15%, humidity detach', () => {
    const box = { initialBoxWeight: 30, boxWeight: 30 };
    const r = computeLtRemainingBoxWeight(box, cones(1, 29), []);
    expect(r.expectedConeCount).toBe(0);
    expect(r.remaining).toBeCloseTo(1, 6);
    expect(r.fullyTransferred).toBe(true);
    expect(r.persistBoxWeight).toBe(0);
  });

  test('header numberOfCones 0, coneData 40, all cones moved: empty carton', () => {
    const box = {
      initialBoxWeight: 50,
      boxWeight: 0.387,
      numberOfCones: 0,
      coneData: { numberOfCones: 40 },
    };
    const r = computeLtRemainingBoxWeight(box, cones(40, 1.24), [], { movedConeCount: 40 });
    expect(r.expectedConeCount).toBe(40);
    expect(r.fullyTransferred).toBe(true);
    expect(r.persistBoxWeight).toBe(0);
  });
});

describe('isCartonEmptyByMovedCount', () => {
  test('true when moved >= expected', () => {
    expect(isCartonEmptyByMovedCount({ numberOfCones: 3 }, 3)).toBe(true);
    expect(isCartonEmptyByMovedCount({ numberOfCones: 3 }, 4)).toBe(true);
  });

  test('false for partial or missing expected', () => {
    expect(isCartonEmptyByMovedCount({ numberOfCones: 7 }, 4)).toBe(false);
    expect(isCartonEmptyByMovedCount({}, 4)).toBe(false);
    expect(isCartonEmptyByMovedCount({ numberOfCones: 0 }, 40)).toBe(false);
  });

  test('header 0 falls back to coneData.numberOfCones', () => {
    expect(expectedYarnBoxConeCount({ numberOfCones: 0, coneData: { numberOfCones: 40 } })).toBe(40);
    expect(isCartonEmptyByMovedCount({ numberOfCones: 0, coneData: { numberOfCones: 40 } }, 40)).toBe(true);
    expect(expectedYarnBoxConeCount({ numberOfCones: 30, coneData: { numberOfCones: 40 } })).toBe(30);
  });
});
