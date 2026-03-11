/**
 * Verification script for knitting remaining formula: remaining = received - completed - m4
 * Run: node scripts/verify-knitting-remaining.js
 */

const formula = (received, completed, m4) => Math.max(0, received - completed - m4);

const cases = [
  { name: 'Call 1', received: 300, completed: 100, m4: 50, expected: 150 },
  { name: 'Call 2', received: 300, completed: 150, m4: 50, expected: 100 },
  { name: 'Call 3', received: 300, completed: 160, m4: 70, expected: 70 },
  { name: 'Init', received: 300, completed: 0, m4: 0, expected: 300 },
  { name: 'All done', received: 300, completed: 300, m4: 60, expected: 0 },
  { name: 'Overproduction', received: 300, completed: 350, m4: 80, expected: 0 },
];

console.log('Knitting remaining verification:\n');
let passed = 0;
for (const c of cases) {
  const result = formula(c.received, c.completed, c.m4);
  const ok = result === c.expected;
  if (ok) passed++;
  console.log(`${c.name}: received=${c.received}, completed=${c.completed}, m4=${c.m4}`);
  console.log(`  → remaining = ${result} ${ok ? '✓' : `✗ (expected ${c.expected})`}\n`);
}
console.log(`Result: ${passed}/${cases.length} passed`);
process.exit(passed === cases.length ? 0 : 1);
