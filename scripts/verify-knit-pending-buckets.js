/**
 * Runs the real report services against the live DB and asserts that the
 * Order Summary totals reconcile with the knitting-pending buckets.
 *
 * Read-only. Run: node scripts/verify-knit-pending-buckets.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  const { getOrderSummaryReport, getKnittingPendingBuckets } = await import(
    '../src/services/production/index.js'
  );
  const { KnitPendingBucket } = await import('../src/services/production/knittingQueueStatus.js');

  const buckets = await getKnittingPendingBuckets();
  const report = await getOrderSummaryReport({}, { page: 1, limit: 10 });
  const t = report.totals;

  const fmt = (n) => Number(n ?? 0).toLocaleString();
  const row = (label, value) => console.log(`  ${label.padEnd(34)} ${fmt(value).padStart(12)}`);

  console.log('=== KNITTING PENDING BUCKETS (factory wide) ===');
  row('on machine', buckets.buckets[KnitPendingBucket.ON_MACHINE]);
  row('unplanned', buckets.buckets[KnitPendingBucket.UNPLANNED]);
  row('short closed (hold)', buckets.buckets[KnitPendingBucket.SHORT_CLOSED]);
  row('closed on machine (excluded)', buckets.buckets[KnitPendingBucket.CLOSED_ON_MACHINE]);
  row('on hold (excluded)', buckets.buckets[KnitPendingBucket.ON_HOLD]);
  console.log('  ' + '-'.repeat(47));
  row('PENDING (on machine + unplanned)', buckets.pendingQty);

  console.log('\n=== ORDER SUMMARY TOTALS (all orders) ===');
  row('totalQty', t.totalQty);
  row('knitPendingQty  (NEW headline)', t.knitPendingQty);
  row('  knitPendingOnMachine', t.knitPendingOnMachine);
  row('  knitPendingUnplanned', t.knitPendingUnplanned);
  row('knitPendingWithoutHold (legacy)', t.knitPendingWithoutHold);
  row('knitPendingWithHold', t.knitPendingWithHold);
  row('holdQty (short close)', t.holdQty);
  row('closedOnMachineQty', t.closedOnMachineQty);
  row('onHoldQty', t.onHoldQty);
  row('transferQty', t.transferQty);
  row('wipQty', t.wipQty);

  console.log('\n=== NEEDLE BREAKDOWN OF ON-MACHINE PENDING ===');
  const needles = Object.entries(buckets.onMachineByNeedle).sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true })
  );
  let needleSum = 0;
  for (const [needle, qty] of needles) {
    needleSum += qty;
    row(`needle ${needle}`, qty);
  }
  console.log('  ' + '-'.repeat(47));
  row('sum of needles', needleSum);

  console.log('\n=== ASSERTIONS ===');
  const checks = [
    [
      'needle breakdown == on-machine bucket',
      needleSum === buckets.buckets[KnitPendingBucket.ON_MACHINE],
    ],
    ['pendingQty == onMachine + unplanned', buckets.pendingQty === buckets.buckets[KnitPendingBucket.ON_MACHINE] + buckets.buckets[KnitPendingBucket.UNPLANNED]],
    [
      'buckets pendingQty == summary knitPendingQty',
      buckets.pendingQty === t.knitPendingQty,
    ],
    [
      'buckets unplanned == summary knitPendingUnplanned',
      buckets.buckets[KnitPendingBucket.UNPLANNED] === t.knitPendingUnplanned,
    ],
    [
      'withHold == pending + hold + closed + onHold',
      Math.abs(
        t.knitPendingWithHold -
          (t.knitPendingQty + t.holdQty + t.closedOnMachineQty + t.onHoldQty)
      ) < 0.001,
    ],
    [
      'legacy withoutHold == withHold - hold',
      Math.abs(t.knitPendingWithoutHold - (t.knitPendingWithHold - t.holdQty)) < 0.001,
    ],
    [
      'totalQty identity (pending+hold+closed+onHold+wip+transfer)',
      Math.abs(
        t.totalQty -
          (t.knitPendingQty +
            t.holdQty +
            t.closedOnMachineQty +
            t.onHoldQty +
            t.wipQty +
            t.transferQty)
      ) < 0.001,
    ],
  ];

  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failed += 1;
  }

  console.log('\n=== IMPACT ON THE HEADLINE NUMBER ===');
  const delta = t.knitPendingQty - t.knitPendingWithoutHold;
  console.log(`  old reported pending : ${fmt(t.knitPendingWithoutHold)}`);
  console.log(`  new reported pending : ${fmt(t.knitPendingQty)}`);
  console.log(
    `  change               : ${fmt(delta)} (${((delta / t.knitPendingWithoutHold) * 100).toFixed(1)}%)`
  );
  console.log(`  unplanned (was hidden from Needle Wise): ${fmt(t.knitPendingUnplanned)}`);
  console.log(`  orphan articles excluded: ${buckets.orphanArticleCount} (${fmt(buckets.orphanPendingQty)})`);
  console.log(`  unplanned articles listed: ${buckets.unplannedArticles.length}`);
  for (const a of buckets.unplannedArticles.slice(0, 10)) {
    console.log(
      `    ${(a.articleNumber || '').padEnd(10)} ${(a.orderNumber || '').padEnd(14)} ${fmt(a.qty).padStart(8)}  ${a.orderNote || ''}`
    );
  }

  await mongoose.disconnect();
  if (failed > 0) process.exit(1);
};

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
