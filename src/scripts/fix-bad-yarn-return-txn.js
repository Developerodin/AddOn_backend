#!/usr/bin/env node
/**
 * Patches a corrupt yarn_returned transaction weight (report-only fix; no inventory delta).
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/fix-bad-yarn-return-txn.js
 *   NODE_ENV=development node src/scripts/fix-bad-yarn-return-txn.js --apply --weight=1.066
 *   NODE_ENV=development node src/scripts/fix-bad-yarn-return-txn.js --txn-id=69f8821c27350179fbb4b2e2 --apply
 */

import url from 'url';

const _origUrlParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try {
    return _origUrlParse.call(this, urlStr, ...args);
  } catch {
    return _origUrlParse.call(this, String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2'), ...args);
  }
};

import mongoose from 'mongoose';
import config from '../config/config.js';
import { YarnTransaction } from '../models/index.js';

const DEFAULT_TXN_ID = '69f8821c27350179fbb4b2e2';
const DEFAULT_WEIGHT = 1.066;

/**
 * @param {string} flag
 * @returns {string|undefined}
 */
function argValue(flag) {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

const txnId = argValue('--txn-id') || DEFAULT_TXN_ID;
const apply = process.argv.includes('--apply');
const weight = Number(argValue('--weight') || DEFAULT_WEIGHT);

async function main() {
  if (!mongoose.Types.ObjectId.isValid(txnId)) {
    throw new Error(`Invalid txn id: ${txnId}`);
  }
  if (!Number.isFinite(weight) || weight < 0 || weight > 50) {
    throw new Error(`Weight must be 0–50 kg for single-cone return; got ${weight}`);
  }

  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  const txn = await YarnTransaction.findById(txnId).lean();
  if (!txn) {
    throw new Error(`Transaction not found: ${txnId}`);
  }
  if (txn.transactionType !== 'yarn_returned') {
    throw new Error(`Expected yarn_returned, got ${txn.transactionType}`);
  }

  console.log('Current:', {
    id: txnId,
    yarnName: txn.yarnName,
    orderno: txn.orderno,
    transactionNetWeight: txn.transactionNetWeight,
    transactionDate: txn.transactionDate,
  });
  console.log('Proposed:', {
    transactionNetWeight: weight,
    transactionTotalWeight: weight,
    transactionTearWeight: 0,
  });

  if (!apply) {
    console.log('\nDry run — pass --apply to update the transaction record.');
    await mongoose.disconnect();
    return;
  }

  await YarnTransaction.updateOne(
    { _id: new mongoose.Types.ObjectId(txnId) },
    {
      $set: {
        transactionNetWeight: weight,
        transactionTotalWeight: weight,
        transactionTearWeight: 0,
      },
    }
  );

  console.log('\nApplied.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
