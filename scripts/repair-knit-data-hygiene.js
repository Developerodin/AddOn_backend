/**
 * Repairs the two small knitting data-hygiene issues found while reconciling
 * the Production Order Summary against Needle Wise planning:
 *
 *   1. Articles whose `orderId` points at a ProductionOrder that no longer
 *      exists. They are invisible to every report but still carry pending qty.
 *   2. Non-integer knitting quantities (pieces are countable).
 *
 * DRY RUN BY DEFAULT. Nothing is written unless --apply is passed.
 * Every intended change is printed first, and a JSON backup of the affected
 * documents is written before any update.
 *
 *   node scripts/repair-knit-data-hygiene.js                 # report only
 *   node scripts/repair-knit-data-hygiene.js --apply         # write changes
 *   node scripts/repair-knit-data-hygiene.js --apply --orphans-only
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const ORPHANS_ONLY = process.argv.includes('--orphans-only');
const FRACTIONS_ONLY = process.argv.includes('--fractions-only');

const KNITTING_FIELDS = ['received', 'completed', 'remaining', 'transferred'];

/**
 * Writes a JSON backup of documents about to change.
 * @param {string} name File label
 * @param {unknown} payload Documents to snapshot
 * @returns {string} Backup file path
 */
const writeBackup = (name, payload) => {
  const dir = path.resolve('backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${name}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
};

/**
 * Finds articles whose parent production order is missing.
 * @param {import('mongodb').Db} db
 */
const findOrphanArticles = async (db) => {
  const orderIds = new Set(
    (await db.collection('production_orders').find({}, { projection: { _id: 1 } }).toArray()).map((o) =>
      String(o._id)
    )
  );
  const articles = await db
    .collection('articles')
    .find({}, { projection: { orderId: 1, articleNumber: 1, status: 1, plannedQuantity: 1, floorQuantities: 1 } })
    .toArray();

  return articles.filter((a) => {
    const oid = a.orderId ? String(a.orderId) : '';
    return !oid || !orderIds.has(oid);
  });
};

/**
 * Finds articles with non-integer knitting quantities.
 * @param {import('mongodb').Db} db
 */
const findFractionalKnitting = async (db) => {
  const articles = await db
    .collection('articles')
    .find({}, { projection: { articleNumber: 1, 'floorQuantities.knitting': 1 } })
    .toArray();

  return articles
    .map((a) => {
      const k = a.floorQuantities?.knitting ?? {};
      const bad = KNITTING_FIELDS.filter((f) => {
        const v = Number(k[f] ?? 0);
        return Number.isFinite(v) && !Number.isInteger(v);
      });
      return bad.length ? { article: a, fields: bad, knitting: k } : null;
    })
    .filter(Boolean);
};

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  const db = mongoose.connection.db;

  console.log(APPLY ? '*** APPLY MODE — changes will be written ***' : 'DRY RUN — no changes written');

  if (!FRACTIONS_ONLY) {
    console.log('\n=== 1. ORPHAN ARTICLES (parent production order missing) ===');
    const orphans = await findOrphanArticles(db);
    if (orphans.length === 0) {
      console.log('  none');
    } else {
      let qty = 0;
      for (const a of orphans) {
        const remaining = Number(a.floorQuantities?.knitting?.remaining ?? 0);
        qty += remaining;
        console.log(
          `  ${String(a.articleNumber).padEnd(10)} orderId=${a.orderId ?? '(none)'} status=${a.status} planned=${a.plannedQuantity} knitRemaining=${remaining}`
        );
      }
      console.log(`  ${orphans.length} article(s), ${qty.toLocaleString()} pcs of hidden pending`);
      console.log(
        '  ACTION: these are flagged only. Re-link to the correct order, or delete them,\n' +
          '          after confirming with ops why the parent order was removed.\n' +
          '          This script never deletes article documents.'
      );
      if (APPLY) {
        const file = writeBackup('orphan-articles', orphans);
        console.log(`  snapshot written: ${file}`);
      }
    }
  }

  if (!ORPHANS_ONLY) {
    console.log('\n=== 2. FRACTIONAL KNITTING QUANTITIES ===');
    const fractional = await findFractionalKnitting(db);
    if (fractional.length === 0) {
      console.log('  none');
    } else {
      for (const { article, fields, knitting } of fractional) {
        const rounded = fields.map((f) => `${f}: ${knitting[f]} -> ${Math.round(Number(knitting[f]))}`);
        console.log(`  ${String(article.articleNumber).padEnd(10)} ${rounded.join(', ')}`);
      }

      if (!APPLY) {
        console.log(`  ${fractional.length} article(s) would be rounded. Re-run with --apply to write.`);
      } else {
        const file = writeBackup('fractional-knitting', fractional);
        console.log(`  snapshot written: ${file}`);

        let updated = 0;
        for (const { article, fields, knitting } of fractional) {
          const $set = {};
          for (const f of fields) {
            $set[`floorQuantities.knitting.${f}`] = Math.round(Number(knitting[f]));
          }
          const res = await db
            .collection('articles')
            .updateOne({ _id: article._id }, { $set });
          updated += res.modifiedCount;
        }
        console.log(`  rounded ${updated} article(s)`);
      }
    }
  }

  console.log('\nDone.');
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
