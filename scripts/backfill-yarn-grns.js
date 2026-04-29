#!/usr/bin/env node
/**
 * Backfill yarn GRNs for every YarnPurchaseOrder that already has lots
 * received but no entry in `grnHistory`. Each PO gets exactly ONE legacy
 * GRN containing all of its current `receivedLotDetails`, dated from the
 * PO's `goodsReceivedDate || createDate`.
 *
 * Run once per environment after the GRN module ships.
 *
 * Usage:
 *   node scripts/backfill-yarn-grns.js                 # dry run (default)
 *   node scripts/backfill-yarn-grns.js --apply         # actually write GRNs
 *   node scripts/backfill-yarn-grns.js --apply --limit 10
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import { YarnPurchaseOrder, YarnGrn } from '../src/models/index.js';
import { buildSnapshot } from '../src/services/yarnManagement/yarnGrnSnapshot.builder.js';
import * as yarnPurchaseOrderService from '../src/services/yarnManagement/yarnPurchaseOrder.service.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIMIT_FLAG_IDX = args.indexOf('--limit');
const LIMIT = LIMIT_FLAG_IDX !== -1 ? parseInt(args[LIMIT_FLAG_IDX + 1] || '0', 10) || 0 : 0;

const log = (msg, data) => {
  if (data === undefined) {
    console.log(msg);
    return;
  }
  console.log(msg, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
};

/**
 * Generate a sequential GRN-LEGACY-#### number that doesn't collide with
 * existing entries. Uses an in-process counter seeded from the highest
 * number already in the collection.
 * @param {number} startSeq
 */
const makeLegacyNumberFactory = (startSeq) => {
  let seq = startSeq;
  return () => {
    seq += 1;
    return `GRN-LEGACY-${String(seq).padStart(4, '0')}`;
  };
};

const findHighestLegacySeq = async () => {
  const last = await YarnGrn.findOne({ grnNumber: { $regex: '^GRN-LEGACY-\\d+$' } })
    .sort({ createdAt: -1 })
    .select('grnNumber')
    .lean();
  if (!last?.grnNumber) return 0;
  const m = last.grnNumber.match(/^GRN-LEGACY-(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
};

const buildLegacyDoc = (po, grnNumber) => {
  const lotNumbers = (po.receivedLotDetails || []).map((l) => l.lotNumber).filter(Boolean);
  if (lotNumbers.length === 0) return null;
  const snapshot = buildSnapshot(po, lotNumbers);
  return {
    grnNumber,
    baseGrnNumber: grnNumber,
    grnDate: po.goodsReceivedDate || po.createDate || po.createdAt || new Date(),
    status: 'active',
    revisionOf: null,
    revisionNo: 0,
    purchaseOrder: po._id,
    poNumber: po.poNumber,
    poDate: po.createDate || po.createdAt,
    ...snapshot,
    vendorInvoiceNo: '',
    vendorInvoiceDate: null,
    discrepancyDetails: '',
    notes: po.notes || '',
    isLegacy: true,
    createdBy: { username: 'backfill-script', email: '' },
  };
};

async function run() {
  const url = config?.mongoose?.url;
  if (!url) throw new Error('Missing config.mongoose.url');

  log(`Connecting to Mongo… (apply=${APPLY ? 'yes' : 'NO — dry run'}, limit=${LIMIT || 'none'})`);
  await mongoose.connect(url, config.mongoose.options || {});

  const filter = {
    'receivedLotDetails.0': { $exists: true },
    $or: [{ grnHistory: { $exists: false } }, { grnHistory: { $size: 0 } }],
  };

  const candidatesCount = await YarnPurchaseOrder.countDocuments(filter);
  log(`Found ${candidatesCount} PO(s) needing backfill.`);

  let cursorQuery = YarnPurchaseOrder.find(filter).select('_id poNumber').sort({ createDate: 1 });
  if (LIMIT > 0) cursorQuery = cursorQuery.limit(LIMIT);

  const startSeq = await findHighestLegacySeq();
  const nextNumber = makeLegacyNumberFactory(startSeq);
  log(`Highest existing GRN-LEGACY seq = ${startSeq}. Will mint GRN-LEGACY-${String(startSeq + 1).padStart(4, '0')} onwards.`);

  const summary = { processed: 0, created: 0, skipped: 0, errors: [] };
  const idsToProcess = await cursorQuery.lean();

  for (const stub of idsToProcess) {
    summary.processed += 1;
    const po = await yarnPurchaseOrderService.getPurchaseOrderById(stub._id.toString());
    if (!po) {
      summary.errors.push({ poId: String(stub._id), error: 'PO not found' });
      continue;
    }
    const grnNumber = nextNumber();
    const doc = buildLegacyDoc(po, grnNumber);
    if (!doc) {
      summary.skipped += 1;
      log(`[SKIP] ${po.poNumber} has no usable lots after build`);
      continue;
    }

    if (!APPLY) {
      log(`[DRY] Would create ${grnNumber} for PO ${po.poNumber} with ${doc.lots.length} lot(s)`);
      summary.created += 1;
      continue;
    }

    try {
      const created = await YarnGrn.create(doc);
      await YarnPurchaseOrder.updateOne(
        { _id: po._id },
        { $push: { grnHistory: created._id } }
      );
      summary.created += 1;
      log(`[OK] ${grnNumber} created for PO ${po.poNumber} (${doc.lots.length} lot(s))`);
    } catch (err) {
      summary.errors.push({ poId: String(po._id), poNumber: po.poNumber, error: err.message || String(err) });
      log(`[ERR] PO ${po.poNumber}: ${err.message || err}`);
    }
  }

  log('\nDone.', summary);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
