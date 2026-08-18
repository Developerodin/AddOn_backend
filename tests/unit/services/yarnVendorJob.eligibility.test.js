import {
  SEND_BLOCK,
  RECEIVE_BLOCK,
  classifyVendorPreview,
  getBoxNetWeight,
  getReceiveBlockReason,
  getSendBlockReason,
} from '../../../src/services/yarnManagement/yarnVendorJob.eligibility.js';

describe('yarnVendorJob.eligibility', () => {
  const ltFlags = { isLt: true, isSt: false };
  const unallocatedFlags = { isLt: false, isSt: false };
  const stFlags = { isLt: false, isSt: true };

  test('getBoxNetWeight uses boxWeight', () => {
    expect(getBoxNetWeight({ boxWeight: 12.5 })).toBe(12.5);
    expect(getBoxNetWeight({ boxWeight: 0 })).toBe(0);
    expect(getBoxNetWeight({})).toBe(0);
  });

  test('send: unallocated with weight is allowed', () => {
    expect(
      getSendBlockReason({ boxWeight: 10, qcData: { status: 'qc_pending' } }, unallocatedFlags)
    ).toBeNull();
  });

  test('send: LT without QC is blocked', () => {
    expect(getSendBlockReason({ boxWeight: 10, qcData: { status: 'qc_pending' } }, ltFlags)).toBe(
      SEND_BLOCK.LT_NOT_QC
    );
  });

  test('send: LT with QC is allowed', () => {
    expect(getSendBlockReason({ boxWeight: 10, qcData: { status: 'qc_approved' } }, ltFlags)).toBeNull();
  });

  test('send: PO returned, at vendor, cones issued, ST, zero weight', () => {
    expect(getSendBlockReason({ returnedToVendorAt: new Date(), boxWeight: 10 }, unallocatedFlags)).toBe(
      SEND_BLOCK.PO_RETURNED
    );
    expect(getSendBlockReason({ atVendorAt: new Date(), boxWeight: 10 }, unallocatedFlags)).toBe(
      SEND_BLOCK.AT_VENDOR
    );
    expect(
      getSendBlockReason({ boxWeight: 10, coneData: { conesIssued: true } }, unallocatedFlags)
    ).toBe(SEND_BLOCK.CONES_ISSUED);
    expect(getSendBlockReason({ boxWeight: 10 }, stFlags)).toBe(SEND_BLOCK.ST_LOCATION);
    expect(getSendBlockReason({ boxWeight: 0 }, unallocatedFlags)).toBe(SEND_BLOCK.NO_WEIGHT);
  });

  test('receive: requires atVendorAt and same supplier', () => {
    expect(getReceiveBlockReason({ boxWeight: 10 })).toBe(RECEIVE_BLOCK.NOT_AT_VENDOR);
    expect(getReceiveBlockReason({ atVendorAt: new Date(), vendorSupplierId: 'aaa' })).toBeNull();
    expect(
      getReceiveBlockReason(
        { atVendorAt: new Date(), vendorSupplierId: 'bbb' },
        { expectedSupplierId: 'aaa' }
      )
    ).toBe(RECEIVE_BLOCK.MIXED_VENDOR);
    expect(getReceiveBlockReason({ atVendorAt: new Date(), returnedToVendorAt: new Date() })).toBe(
      RECEIVE_BLOCK.PO_RETURNED
    );
  });

  test('preview classifies send vs receive vs none', () => {
    expect(classifyVendorPreview({ boxWeight: 8 }, unallocatedFlags)).toEqual({
      eligibleFor: 'send',
      reason: null,
    });
    expect(classifyVendorPreview({ boxWeight: 8, atVendorAt: new Date() }, unallocatedFlags)).toEqual({
      eligibleFor: 'receive',
      reason: null,
    });
    expect(classifyVendorPreview({ boxWeight: 0 }, unallocatedFlags).eligibleFor).toBe('none');
  });
});
