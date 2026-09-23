import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { VendorBox, VendorProductionFlow } from '../../../src/models/index.js';
import { scanAcceptVendorBoxForSecondaryChecking } from '../../../src/services/vendorManagement/vendorBox.service.js';

const vendorId = new mongoose.Types.ObjectId();
const vpoId = new mongoose.Types.ObjectId();
const productId = new mongoose.Types.ObjectId();
const boxOid = new mongoose.Types.ObjectId();
const flowOid = new mongoose.Types.ObjectId();
const UNITS = 775;

/**
 * Builds a vendor-box fixture for scan-accept tests.
 * @param {{ accepted: boolean }} opts
 * @returns {object}
 */
function makeBox({ accepted }) {
  return {
    _id: boxOid,
    boxId: 'VBOX-TEST-SCAN',
    barcode: 'test-scan-barcode',
    vendor: vendorId,
    vendorPurchaseOrderId: vpoId,
    productId,
    vpoNumber: 'VPO-TEST-SCAN',
    productName: 'Test Product',
    numberOfUnits: UNITS,
    secondaryCheckingAccepted: accepted,
    secondaryCheckingAcceptedAt: accepted ? new Date() : null,
  };
}

/**
 * Builds an in-memory production flow whose `save` persists field updates.
 * @param {{ received: number }} opts
 * @returns {object}
 */
function makeFlow({ received }) {
  return {
    _id: flowOid,
    vendor: vendorId,
    vendorPurchaseOrder: vpoId,
    product: productId,
    plannedQuantity: UNITS,
    floorQuantities: {
      secondaryChecking: {
        received,
        remaining: received,
        pendingFromBoxes: received > 0 ? 0 : UNITS,
        m1Quantity: 0,
        m2Quantity: 0,
        m3Quantity: 0,
        vm4Quantity: 0,
      },
    },
    async save() {
      return this;
    },
  };
}

/**
 * Mongoose-like findOne that supports both `await findOne()` and `findOne().lean()`.
 * @param {object|null} doc
 * @returns {{ lean: Function, then: Function }}
 */
function thenableFindOne(doc) {
  return {
    lean: jest.fn().mockResolvedValue(doc),
    then(resolve, reject) {
      return Promise.resolve(doc).then(resolve, reject);
    },
  };
}

/**
 * Mongoose-like findById().populate().populate() chain.
 * @param {object|null} doc
 * @returns {{ populate: Function, then: Function }}
 */
function thenablePopulate(doc) {
  const chain = {
    populate() {
      return chain;
    },
    then(resolve, reject) {
      return Promise.resolve(doc).then(resolve, reject);
    },
  };
  return chain;
}

/**
 * Installs mongoose spies for one scan-accept scenario.
 * @param {{ box: object, claimed: object|null, flow: object, acceptedBoxes: object[] }} opts
 */
function stubScanAcceptDeps({ box, claimed, flow, acceptedBoxes }) {
  jest.spyOn(VendorBox, 'findOne').mockResolvedValue(box);
  jest.spyOn(VendorBox, 'findOneAndUpdate').mockResolvedValue(claimed);
  jest.spyOn(VendorBox, 'findById').mockResolvedValue(claimed || box);
  jest.spyOn(VendorBox, 'find').mockReturnValue({
    lean: jest.fn().mockResolvedValue(acceptedBoxes),
  });
  jest.spyOn(VendorProductionFlow, 'countDocuments').mockResolvedValue(1);
  jest.spyOn(VendorProductionFlow, 'findOne').mockReturnValue(thenableFindOne(flow));
  jest.spyOn(VendorProductionFlow, 'findById').mockImplementation(() => thenablePopulate(flow));
}

describe('scanAcceptVendorBoxForSecondaryChecking', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('accept claims the flag then reconcile sets sc.received to box units', async () => {
    const pendingBox = makeBox({ accepted: false });
    const claimedBox = { ...pendingBox, secondaryCheckingAccepted: true, secondaryCheckingAcceptedAt: new Date() };
    const flow = makeFlow({ received: 0 });

    stubScanAcceptDeps({
      box: pendingBox,
      claimed: claimedBox,
      flow,
      acceptedBoxes: [{ numberOfUnits: UNITS, secondaryCheckingAccepted: true }],
    });

    const result = await scanAcceptVendorBoxForSecondaryChecking(pendingBox.barcode);

    expect(VendorBox.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: pendingBox._id, secondaryCheckingAccepted: { $ne: true } },
      expect.objectContaining({
        $set: expect.objectContaining({ secondaryCheckingAccepted: true }),
      }),
      { new: true }
    );
    expect(claimedBox.secondaryCheckingAccepted).toBe(true);
    expect(result.box.secondaryCheckingAccepted).toBe(true);
    expect(result.acceptedUnits).toBe(UNITS);
    expect(result.flow.floorQuantities.secondaryChecking.received).toBe(UNITS);
    expect(flow.floorQuantities.secondaryChecking.received).toBe(UNITS);
    expect(flow.floorQuantities.secondaryChecking.pendingFromBoxes).toBe(0);
  });

  test('already-accepted retry does not throw and repairs received without doubling', async () => {
    const acceptedBox = makeBox({ accepted: true });
    const flow = makeFlow({ received: 0 });

    stubScanAcceptDeps({
      box: acceptedBox,
      claimed: null,
      flow,
      acceptedBoxes: [{ numberOfUnits: UNITS, secondaryCheckingAccepted: true }],
    });

    const first = await scanAcceptVendorBoxForSecondaryChecking(acceptedBox.barcode);

    expect(first.acceptedUnits).toBe(UNITS);
    expect(first.isNewOrder).toBe(false);
    expect(first.isNewArticle).toBe(false);
    expect(first.flow.floorQuantities.secondaryChecking.received).toBe(UNITS);
    expect(flow.floorQuantities.secondaryChecking.received).toBe(UNITS);

    const second = await scanAcceptVendorBoxForSecondaryChecking(acceptedBox.barcode);

    expect(second.acceptedUnits).toBe(UNITS);
    expect(second.isNewOrder).toBe(false);
    expect(second.isNewArticle).toBe(false);
    expect(second.flow.floorQuantities.secondaryChecking.received).toBe(UNITS);
    expect(flow.floorQuantities.secondaryChecking.received).toBe(UNITS);
  });
});
