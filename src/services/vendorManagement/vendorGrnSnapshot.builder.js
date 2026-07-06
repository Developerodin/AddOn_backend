/**
 * Pure helpers that build a VendorGrn snapshot from a populated flow + VPO.
 * No Mongo I/O — keeps the service file thin and unit-testable.
 */

/**
 * @param {*} value
 * @returns {number}
 */
const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * @param {string|null|undefined} value
 * @returns {string}
 */
const trimSafe = (value) => (value == null ? '' : String(value).trim());

/**
 * Resolve PO line item _id for a product on the VPO.
 * @param {Object} vpo
 * @param {Object|string} product
 * @returns {string|null}
 */
const resolvePoItemId = (vpo, product) => {
  const productId = product?._id?.toString?.() || (typeof product === 'string' ? product : null);
  if (!productId || !Array.isArray(vpo?.poItems)) return null;
  const match = vpo.poItems.find((it) => String(it.productId) === String(productId));
  return match?._id?.toString?.() || null;
};

/**
 * Collect unique lot numbers for a flow from receivedData, boxes, or reference code.
 * @param {Object} flow
 * @param {Array<Object>} boxes
 * @returns {string[]}
 */
const collectLotNumbers = (flow, boxes = []) => {
  const sc = flow?.floorQuantities?.secondaryChecking || {};
  const fromData = (sc.receivedData || [])
    .map((r) => trimSafe(r.lotNumber))
    .filter(Boolean);
  const fromBoxes = boxes.map((b) => trimSafe(b.lotNumber)).filter(Boolean);
  const lots = [...new Set([...fromData, ...fromBoxes])];
  if (lots.length === 0 && trimSafe(flow?.referenceCode)) {
    lots.push(trimSafe(flow.referenceCode));
  }
  return lots;
};

/**
 * Build vendor snapshot block from populated flow.
 * @param {Object} flow
 */
const buildVendorSnapshot = (flow) => {
  const vm = flow?.vendor && typeof flow.vendor === 'object' ? flow.vendor : {};
  const header = vm?.header || {};
  return {
    vendorId: vm?._id || flow?.vendor || null,
    vendorName: trimSafe(header.vendorName || flow?.vendorPurchaseOrder?.vendorName),
    vendorCode: trimSafe(header.vendorCode),
    gstin: trimSafe(header.gstin || header.gstNo),
    address: trimSafe(header.address),
    city: trimSafe(header.city),
    state: trimSafe(header.state),
    pincode: trimSafe(header.pincode),
  };
};

/**
 * Prorate verified qty across lots by scan-accepted share.
 * @param {number} verifiedQty
 * @param {number} lotScan
 * @param {number} totalScan
 */
const prorateVerified = (verifiedQty, lotScan, totalScan) => {
  if (totalScan <= 0) return verifiedQty;
  return Math.round((verifiedQty * lotScan) / totalScan);
};

/**
 * Build GRN lots[] + totals from a single production flow.
 * @param {Object} params
 * @param {Object} params.flow - populated VendorProductionFlow
 * @param {Object} params.vpo - populated VendorPurchaseOrder
 * @param {Array<Object>} [params.boxes] - accepted VendorBox docs for this flow
 * @returns {{ lots: Array<Object>, totals: Object }}
 */
export const buildSnapshotFromFlow = ({ flow, vpo, boxes = [] }) => {
  const sc = flow?.floorQuantities?.secondaryChecking || {};
  const m1 = toNumber(sc.m1Quantity);
  const m2 = toNumber(sc.m2Quantity);
  const m3 = toNumber(sc.m3Quantity);
  const vm4 = toNumber(sc.vm4Quantity ?? sc.m4Quantity);
  const verifiedQty = m1 + m2 + m3 + vm4;
  const scanAcceptedQty = toNumber(sc.received);
  const product = flow?.product && typeof flow.product === 'object' ? flow.product : {};
  const poItemId = resolvePoItemId(vpo, product);
  const lotNumbers = collectLotNumbers(flow, boxes);

  const scanByLot = new Map();
  lotNumbers.forEach((lot) => scanByLot.set(lot, 0));
  boxes.forEach((box) => {
    const lot = trimSafe(box.lotNumber);
    if (!lot) return;
    scanByLot.set(lot, (scanByLot.get(lot) || 0) + toNumber(box.numberOfUnits));
  });
  if (lotNumbers.length === 1 && scanAcceptedQty > 0) {
    scanByLot.set(lotNumbers[0], scanAcceptedQty);
  }
  const totalScan = [...scanByLot.values()].reduce((s, v) => s + v, 0) || scanAcceptedQty;

  const lots = lotNumbers.map((lotNumber) => {
    const lotDetail = (vpo?.receivedLotDetails || []).find(
      (l) => trimSafe(l.lotNumber) === lotNumber
    );
    const lotBoxes = boxes.filter((b) => trimSafe(b.lotNumber) === lotNumber);
    const lotScan = scanByLot.get(lotNumber) || 0;

    let expectedQty = 0;
    if (lotDetail && poItemId) {
      const line = (lotDetail.poItems || []).find(
        (pi) => String(pi.poItem) === String(poItemId)
      );
      expectedQty = toNumber(line?.receivedQuantity);
    }
    if (expectedQty <= 0 && lotBoxes.length) {
      expectedQty = lotBoxes.reduce((s, b) => s + toNumber(b.numberOfUnits), 0);
    }

    const lotVerified = prorateVerified(verifiedQty, lotScan || expectedQty, totalScan || verifiedQty);
    const lotM1 = prorateVerified(m1, lotScan || expectedQty, totalScan || verifiedQty);
    const lotM2 = prorateVerified(m2, lotScan || expectedQty, totalScan || verifiedQty);
    const lotM3 = prorateVerified(m3, lotScan || expectedQty, totalScan || verifiedQty);
    const lotM4 = prorateVerified(vm4, lotScan || expectedQty, totalScan || verifiedQty);

    return {
      lotNumber,
      numberOfBoxes: lotDetail ? toNumber(lotDetail.numberOfBoxes) : lotBoxes.length,
      totalUnits: lotDetail ? toNumber(lotDetail.totalUnits) : lotScan,
      items: [
        {
          poItem: poItemId,
          productId: product?._id || flow?.product,
          productName: trimSafe(product?.name),
          vendorCode: trimSafe(product?.vendorCode),
          expectedQty,
          scanAcceptedQty: lotScan,
          verifiedQty: lotVerified,
          m1: lotM1,
          m2: lotM2,
          m3: lotM3,
          m4: lotM4,
          varianceQty: lotVerified - expectedQty,
          vendorProductionFlowId: flow?._id || flow?.id,
          boxIds: lotBoxes.map((b) => trimSafe(b.boxId)).filter(Boolean),
        },
      ],
    };
  });

  const totals = lots.reduce(
    (acc, lot) => {
      (lot.items || []).forEach((it) => {
        acc.expected += toNumber(it.expectedQty);
        acc.verified += toNumber(it.verifiedQty);
        acc.variance += toNumber(it.varianceQty);
        acc.m1 += toNumber(it.m1);
        acc.m2 += toNumber(it.m2);
        acc.m3 += toNumber(it.m3);
        acc.m4 += toNumber(it.m4);
      });
      return acc;
    },
    { expected: 0, verified: 0, variance: 0, m1: 0, m2: 0, m3: 0, m4: 0 }
  );

  return { lots, totals };
};

/**
 * Compute shallow diff between two snapshot blocks for revision metadata.
 * @param {Object} before
 * @param {Object} after
 * @returns {Array<{ field: string, before: *, after: * }>}
 */
export const computeSnapshotDiff = (before, after) => {
  const diff = [];
  const keys = ['totals', 'lots'];
  keys.forEach((key) => {
    const b = JSON.stringify(before?.[key] ?? null);
    const a = JSON.stringify(after?.[key] ?? null);
    if (b !== a) {
      diff.push({ field: key, before: before?.[key], after: after?.[key] });
    }
  });
  return diff;
};

/**
 * Build header fields shared by create/revise.
 * @param {Object} flow
 * @param {Object} vpo
 */
export const buildGrnHeaderFromFlow = (flow, vpo) => ({
  vendorPurchaseOrder: vpo?._id || flow?.vendorPurchaseOrder,
  vpoNumber: trimSafe(vpo?.vpoNumber),
  vpoDate: vpo?.createDate || vpo?.createdAt || null,
  vendor: buildVendorSnapshot(flow),
});
