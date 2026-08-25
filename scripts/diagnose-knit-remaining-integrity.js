/**
 * Is knitting.remaining trustworthy? Checks remaining == received - completed
 * for articles that still carry pending knitting, and hunts fractional qtys.
 *
 * Read-only. Run: node scripts/diagnose-knit-remaining-integrity.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const toNumber = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  const db = mongoose.connection.db;

  const articles = await db
    .collection('articles')
    .find({}, { projection: { articleNumber: 1, status: 1, plannedQuantity: 1, floorQuantities: 1 } })
    .toArray();

  let pendingArticles = 0;
  let pendingBalanced = 0;
  let pendingUnbalanced = 0;
  let pendingUnbalancedQty = 0;
  const unbalancedSamples = [];

  let fractional = 0;
  const fractionalSamples = [];

  for (const a of articles) {
    const k = a.floorQuantities?.knitting ?? {};
    const received = toNumber(k.received);
    const completed = toNumber(k.completed);
    const remaining = toNumber(k.remaining);

    if (!Number.isInteger(received) || !Number.isInteger(completed) || !Number.isInteger(remaining)) {
      fractional += 1;
      if (fractionalSamples.length < 15) {
        fractionalSamples.push({ art: a.articleNumber, received, completed, remaining });
      }
    }

    if (remaining <= 0) continue;
    pendingArticles += 1;
    const expected = received - completed;
    if (Math.abs(expected - remaining) < 0.001) {
      pendingBalanced += 1;
    } else {
      pendingUnbalanced += 1;
      pendingUnbalancedQty += Math.abs(expected - remaining);
      if (unbalancedSamples.length < 20) {
        unbalancedSamples.push({
          art: a.articleNumber,
          status: a.status,
          planned: toNumber(a.plannedQuantity),
          received,
          completed,
          remaining,
          expected,
          delta: remaining - expected,
        });
      }
    }
  }

  console.log('=== IS knitting.remaining TRUSTWORTHY? (articles with remaining > 0) ===');
  console.log('articles with remaining > 0 :', pendingArticles);
  console.log('  remaining == recv - comp  :', pendingBalanced);
  console.log('  mismatched                :', pendingUnbalanced, `(total drift ${pendingUnbalancedQty.toLocaleString()})`);

  if (unbalancedSamples.length) {
    console.log('\nmismatched samples:');
    console.log(['article', 'status', 'plan', 'recv', 'comp', 'remain', 'expected', 'delta'].join('\t'));
    for (const s of unbalancedSamples) {
      console.log([s.art, s.status, s.planned, s.received, s.completed, s.remaining, s.expected, s.delta].join('\t'));
    }
  }

  console.log('\n=== FRACTIONAL KNITTING QUANTITIES ===');
  console.log('articles with non-integer knitting qty:', fractional);
  if (fractionalSamples.length) {
    console.log(['article', 'recv', 'comp', 'remain'].join('\t'));
    for (const s of fractionalSamples) {
      console.log([s.art, s.received, s.completed, s.remaining].join('\t'));
    }
  }

  // Where does the earlier "received < completed + remaining" imbalance live?
  console.log('\n=== LEDGER IMBALANCE BY remaining VALUE ===');
  let zeroRemainImbalance = 0;
  let zeroRemainCount = 0;
  for (const a of articles) {
    const k = a.floorQuantities?.knitting ?? {};
    const delta = toNumber(k.received) - toNumber(k.completed) - toNumber(k.remaining);
    if (delta !== 0 && toNumber(k.remaining) <= 0) {
      zeroRemainImbalance += Math.abs(delta);
      zeroRemainCount += 1;
    }
  }
  console.log(
    'imbalance sitting on articles with remaining <= 0 :',
    zeroRemainImbalance.toLocaleString(),
    `(${zeroRemainCount} articles) -- does NOT affect knit pending`
  );

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
