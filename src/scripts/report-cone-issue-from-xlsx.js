#!/usr/bin/env node

/**
 * Read cone keys from an `.xlsx` column (Mongo `_id` **or** `YarnCone.barcode`).
 * Handles sheets where row 1 is a note: scans rows to find a header like `CONE ID05`.
 *
 * Usage:
 *   cd AddOn_backend && NODE_ENV=development node src/scripts/report-cone-issue-from-xlsx.js
 *   node src/scripts/report-cone-issue-from-xlsx.js --xlsx="./Short Term Yarn Return.xlsx"
 *   node src/scripts/report-cone-issue-from-xlsx.js --xlsx="..." --sheet="Sheet1" --column="CONE ID05"
 *   node src/scripts/report-cone-issue-from-xlsx.js --header-row=2
 *   node src/scripts/report-cone-issue-from-xlsx.js --out="./reports/cone-issue-report.csv"
 *
 * Issue transaction types considered:
 *   yarn_issued | yarn_issued_linking | yarn_issued_sampling
 */

import url from 'url';
const _origUrlParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try {
    return _origUrlParse.call(this, urlStr, ...args);
  } catch {
    const firstHost = String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2');
    return _origUrlParse.call(this, firstHost, ...args);
  }
};

import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import logger from '../config/logger.js';
import { parseConeKeysFromXlsx } from './cone-issue-from-xlsx.parse.js';
import {
  connectMongo,
  csvEscape,
  hydrateOrderAndArticleMaps,
  isCanonicalObjectIdString,
  loadConesForExcelKeys,
  mapConeIdToLatestIssueTxn,
} from './cone-issue-from-xlsx.report-lib.js';

/**
 * @param {string} argPrefix
 * @returns {string | null}
 */
function parseSingleArg(argPrefix) {
  const raw = process.argv.find((a) => a.startsWith(argPrefix));
  if (!raw) return null;
  const v = raw.slice(argPrefix.length).trim();
  return v || null;
}

/**
 * Writes CSV report rows for cone keys from the workbook.
 * @returns {Promise<void>}
 */
async function main() {
  const xlsxArg = parseSingleArg('--xlsx=');
  const sheetArg = parseSingleArg('--sheet=');
  const columnArg = parseSingleArg('--column=');
  const headerRowArg = parseSingleArg('--header-row=');
  const outArg = parseSingleArg('--out=');

  let headerRow1Based = null;
  if (headerRowArg != null && String(headerRowArg).trim() !== '') {
    const n = Number(headerRowArg);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error(`Invalid --header-row=${headerRowArg} (expect positive integer, Excel row of headers).`);
    }
    headerRow1Based = n;
  }

  const xlsxPath = xlsxArg
    ? path.resolve(process.cwd(), xlsxArg)
    : path.resolve(process.cwd(), 'Short Term Yarn Return.xlsx');
  const outPath = outArg
    ? path.resolve(process.cwd(), outArg)
    : path.resolve(process.cwd(), `cone-issue-from-xlsx-${Date.now()}.csv`);

  const { sheetUsed, headerRow1Based: detectedHeaderRow, columnLabel, keysInOrder } = parseConeKeysFromXlsx(
    xlsxPath,
    sheetArg,
    columnArg,
    headerRow1Based
  );
  if (keysInOrder.length === 0) {
    logger.warn(
      `No cone keys found under "${columnLabel}" in ${xlsxPath} sheet "${sheetUsed}", header row ${detectedHeaderRow}.`
    );
    return;
  }

  await connectMongo();

  const coneByInputKey = await loadConesForExcelKeys(keysInOrder);

  /** @type {Set<string>} */
  const mongoIdsNeeded = new Set();
  for (const raw of keysInOrder) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) continue;
    const cone = coneByInputKey.get(trimmed);
    if (cone?._id) mongoIdsNeeded.add(String(cone._id));
  }

  const txnByCone = await mapConeIdToLatestIssueTxn(mongoIdsNeeded);
  const { orderNoById, articleNoById } = await hydrateOrderAndArticleMaps(txnByCone.values());

  const header = [
    'inputFromExcel',
    'excelColumnHeader',
    'excelHeaderRow',
    'resolvedInputKind',
    'coneMongoId',
    'coneBarcode',
    'coneYarnName',
    'coneIssueStatus',
    'issueTxnId',
    'transactionType',
    'transactionDate',
    'orderId',
    'orderno',
    'articleId',
    'articleNumber',
    'yarnNameOnTxn',
    'transactionConeCount',
    'note',
  ];

  /** @type {Record<string, string | number | undefined>[]} */
  const rows = [];

  for (const cell of keysInOrder) {
    const trimmed = String(cell ?? '').trim();

    const resolvedKind = isCanonicalObjectIdString(trimmed) ? 'cone_object_id' : 'barcode';
    const cone = coneByInputKey.get(trimmed) ?? null;
    const coneIdStr = cone?._id ? String(cone._id) : '';
    const txn = coneIdStr ? txnByCone.get(coneIdStr) : undefined;

    let orderno = txn?.orderno ? String(txn.orderno).trim() : '';
    if (!orderno && txn?.orderId) orderno = orderNoById.get(String(txn.orderId)) || '';

    let articleNumber = txn?.articleNumber ? String(txn.articleNumber).trim() : '';
    if (!articleNumber && txn?.articleId) articleNumber = articleNoById.get(String(txn.articleId)) || '';

    let note = '';
    if (!cone) {
      note =
        resolvedKind === 'cone_object_id'
          ? 'No YarnCone for this ObjectId'
          : 'No YarnCone found for this barcode (exact + case-insensitive)';
    } else if (!txn) {
      note = 'No issue YarnTransaction references this cone in conesIdsArray';
    }

    if (txn && !orderno && !articleNumber && !txn.orderId && !txn.articleId) {
      note = note ? `${note}; ` : '';
      note += 'Txn has no order/article refs (e.g. linking/sampling floor issue)';
    }

    rows.push({
      inputFromExcel: trimmed,
      excelColumnHeader: columnLabel,
      excelHeaderRow: String(detectedHeaderRow),
      resolvedInputKind: resolvedKind,
      coneMongoId: coneIdStr,
      coneBarcode: cone?.barcode != null ? String(cone.barcode) : '',
      coneYarnName: cone?.yarnName != null ? String(cone.yarnName) : '',
      coneIssueStatus: cone?.issueStatus != null ? String(cone.issueStatus) : '',
      issueTxnId: txn?._id != null ? String(txn._id) : '',
      transactionType: txn?.transactionType != null ? String(txn.transactionType) : '',
      transactionDate: txn?.transactionDate != null ? new Date(txn.transactionDate).toISOString() : '',
      orderId: txn?.orderId != null ? String(txn.orderId) : '',
      orderno,
      articleId: txn?.articleId != null ? String(txn.articleId) : '',
      articleNumber,
      yarnNameOnTxn: txn?.yarnName != null ? String(txn.yarnName) : '',
      transactionConeCount:
        txn?.transactionConeCount != null && txn.transactionConeCount !== ''
          ? Number(txn.transactionConeCount)
          : '',
      note,
    });
  }

  const csvLines = [header.join(',')];
  for (const r of rows) {
    csvLines.push(header.map((k) => csvEscape(r[k])).join(','));
  }
  await fs.writeFile(outPath, csvLines.join('\n') + '\n', 'utf-8');
  logger.info(`Wrote ${rows.length} row(s) -> ${outPath}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error(`[report-cone-issue-from-xlsx] ${err?.message || err}`);
  process.exitCode = 1;
});
