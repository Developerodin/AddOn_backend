/**
 * Fix corrupted finalChecking.receivedData for a given article / order.
 *
 * Usage:  node src/scripts/fix-stylecode-receiveddata.js <articleNumber> <orderNumber> [--dry-run]
 * Example: node src/scripts/fix-stylecode-receiveddata.js A2757 ORD-000002
 *
 * Bug: The auto-populate logic in updateArticleFloorReceivedData always iterated
 * from the start of branding.transferredData without deducting already-received
 * quantities, causing all container accepts to pick up the first style code.
 *
 * This script recalculates finalChecking.receivedData from branding.transferredData,
 * properly distributing style codes across the existing received entries.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = process.argv.filter(a => !a.startsWith('--'));
const ARTICLE_NUMBER = args[2];
const ORDER_NUMBER = args[3];
const DRY_RUN = process.argv.includes('--dry-run');

if (!ARTICLE_NUMBER || !ORDER_NUMBER) {
  console.error('Usage: node fix-stylecode-receiveddata.js <articleNumber> <orderNumber> [--dry-run]');
  console.error('Example: node fix-stylecode-receiveddata.js A2757 ORD-000002');
  process.exit(1);
}

async function fix() {
  await mongoose.connect(process.env.MONGODB_URL);
  console.log(`Connected to MongoDB`);
  console.log(`Fixing article ${ARTICLE_NUMBER} in order ${ORDER_NUMBER}`);
  if (DRY_RUN) console.log('*** DRY RUN MODE - no changes will be saved ***\n');

  const db = mongoose.connection.db;

  const order = await db.collection('production_orders').findOne({ orderNumber: ORDER_NUMBER });
  if (!order) { console.log(`Order ${ORDER_NUMBER} not found`); process.exit(1); }

  const article = await db.collection('articles').findOne({
    orderId: order._id,
    articleNumber: ARTICLE_NUMBER
  });
  if (!article) { console.log(`Article ${ARTICLE_NUMBER} not found in order ${ORDER_NUMBER}`); process.exit(1); }

  const fq = article.floorQuantities;
  const brandingTd = fq.branding?.transferredData || [];
  const fcRd = fq.finalChecking?.receivedData || [];

  console.log('=== BEFORE FIX ===');
  console.log('Branding transferredData:');
  brandingTd.forEach((td, i) => console.log(`  [${i}] transferred=${td.transferred}, styleCode="${td.styleCode}", brand="${td.brand}"`));
  console.log('Final Checking receivedData:');
  fcRd.forEach((rd, i) => console.log(`  [${i}] transferred=${rd.transferred}, styleCode="${rd.styleCode || ''}", brand="${rd.brand || ''}", containerId=${rd.receivedInContainerId || 'null'}`));

  if (brandingTd.length === 0) {
    console.log('\nNo branding transferredData to work from. Cannot fix.');
    await mongoose.disconnect();
    return;
  }

  // Recalculate: distribute received entries across transferredData entries
  // preserving container/timestamp info from existing receivedData
  const consumedPerEntry = new Array(brandingTd.length).fill(0);
  const fixedReceivedData = [];

  for (const rd of fcRd) {
    let remaining = rd.transferred || 0;
    if (remaining <= 0) {
      fixedReceivedData.push(rd);
      continue;
    }

    const pieces = [];
    for (let j = 0; j < brandingTd.length; j++) {
      if (remaining <= 0) break;
      const td = brandingTd[j];
      const available = (td.transferred || 0) - consumedPerEntry[j];
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      if (take > 0) {
        consumedPerEntry[j] += take;
        remaining -= take;
        pieces.push({ transferred: take, styleCode: td.styleCode || '', brand: td.brand || '' });
      }
    }

    if (pieces.length === 0) {
      fixedReceivedData.push(rd);
      continue;
    }

    // If all assigned to a single style/brand, update the existing entry in place
    if (pieces.length === 1) {
      fixedReceivedData.push({
        ...rd,
        transferred: pieces[0].transferred,
        styleCode: pieces[0].styleCode,
        brand: pieces[0].brand
      });
    } else {
      // Split into multiple entries (first one keeps original container/timestamp, rest copy it)
      for (const piece of pieces) {
        fixedReceivedData.push({
          ...rd,
          transferred: piece.transferred,
          styleCode: piece.styleCode,
          brand: piece.brand
        });
      }
    }
  }

  console.log('\n=== AFTER FIX ===');
  console.log('Final Checking receivedData:');
  fixedReceivedData.forEach((rd, i) => console.log(`  [${i}] transferred=${rd.transferred}, styleCode="${rd.styleCode || ''}", brand="${rd.brand || ''}", containerId=${rd.receivedInContainerId || 'null'}`));

  // Verify totals
  const oldTotal = fcRd.reduce((s, r) => s + (r.transferred || 0), 0);
  const newTotal = fixedReceivedData.reduce((s, r) => s + (r.transferred || 0), 0);
  console.log(`\nTotal transferred - before: ${oldTotal}, after: ${newTotal}`);

  if (oldTotal !== newTotal) {
    console.log('WARNING: totals don\'t match! Aborting.');
    await mongoose.disconnect();
    return;
  }

  if (!DRY_RUN) {
    await db.collection('articles').updateOne(
      { _id: article._id },
      { $set: { 'floorQuantities.finalChecking.receivedData': fixedReceivedData } }
    );
    console.log('\nFix applied successfully.');
  } else {
    console.log('\nDry run complete. Run without --dry-run to apply.');
  }

  await mongoose.disconnect();
}

fix().catch(err => {
  console.error('Error:', err);
  mongoose.disconnect();
  process.exit(1);
});
