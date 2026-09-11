import {
  BOX_WEIGHT_EQ_EPS_KG,
  mongoBoxNetWeightExpr,
  resolveBoxNetWeightKg,
} from '../../../src/services/yarnManagement/yarnBoxWeight.helper.js';

describe('resolveBoxNetWeightKg', () => {
  test('canonical: boxWeight is net when it is less than gross', () => {
    expect(
      resolveBoxNetWeightKg({ boxWeight: 20, grossWeight: 22.2, tearweight: 2.2 })
    ).toBe(20);
  });

  test('legacy: boxWeight === grossWeight means carton gross; subtract tare', () => {
    expect(
      resolveBoxNetWeightKg({ boxWeight: 22.7, grossWeight: 22.7, tearweight: 2.2 })
    ).toBeCloseTo(20.5, 6);
  });

  test('legacy equality uses epsilon', () => {
    expect(
      resolveBoxNetWeightKg({
        boxWeight: 22.7 + BOX_WEIGHT_EQ_EPS_KG / 2,
        grossWeight: 22.7,
        tearweight: 2.2,
      })
    ).toBeCloseTo(20.5, 6);
  });

  test('no grossWeight: net = boxWeight − tare', () => {
    expect(resolveBoxNetWeightKg({ boxWeight: 22, tearweight: 2 })).toBe(20);
  });

  test('missing boxWeight is 0', () => {
    expect(resolveBoxNetWeightKg({})).toBe(0);
    expect(resolveBoxNetWeightKg({ grossWeight: 22, tearweight: 2 })).toBe(0);
  });

  test('does not double-subtract when boxWeight is already net', () => {
    expect(
      resolveBoxNetWeightKg({ boxWeight: 18.5, grossWeight: 22, tearweight: 3.5 })
    ).toBe(18.5);
  });

  test('boxWeight above gross falls back to boxWeight − tare', () => {
    expect(
      resolveBoxNetWeightKg({ boxWeight: 30, grossWeight: 22, tearweight: 2 })
    ).toBe(28);
  });
});

describe('mongoBoxNetWeightExpr', () => {
  test('emits a $let comparing boxWeight to grossWeight', () => {
    const expr = mongoBoxNetWeightExpr();
    expect(expr.$let.vars.bw).toEqual({ $ifNull: ['$boxWeight', 0] });
    expect(expr.$let.vars.gw).toEqual({ $ifNull: ['$grossWeight', 0] });
    expect(expr.$let.in.$cond[0]).toEqual({ $gt: ['$$gw', 0] });
  });
});
