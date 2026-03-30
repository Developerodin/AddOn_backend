/**
 * List products that share the same `processes` configuration (processItemSchema / processId chain).
 *
 * Default: groups products with the **same sequence** of process IDs (order matters — matches production flow).
 * Use `--ignore-order` to group by the **same set** of processes (IDs sorted, duplicates collapsed once).
 *
 * Usage (from repo root, with .env loaded like the app):
 *   node src/scripts/list-products-by-similar-processes.js
 *   node src/scripts/list-products-by-similar-processes.js --ignore-order
 *   node src/scripts/list-products-by-similar-processes.js --json
 *   node src/scripts/list-products-by-similar-processes.js --min-size=1
 *   node src/scripts/list-products-by-similar-processes.js --no-products
 *   node src/scripts/list-products-by-similar-processes.js --json --no-products
 *
 * Text output: SUMMARY (counts), global "processes → product count", then each GROUP with
 * numbered process steps (full processId, name, type) and optional product list.
 *
 * JSON shape: { summary, processesReferencedByProductCount, groups[] } (groups[].products omitted if --no-products).
 *
 * Env: NODE_ENV, MONGODB_URL (via src/config/config.js)
 */
import mongoose from 'mongoose';
import config from '../config/config.js';
import Product from '../models/product.model.js';
/** Required so `populate('processes.processId')` can resolve ref: 'Process' */
import '../models/process.model.js';

function parseArgs(argv) {
  const out = {
    ignoreOrder: false,
    json: false,
    minSize: 2,
    noProducts: false,
  };
  for (const a of argv) {
    if (a === '--ignore-order') out.ignoreOrder = true;
    else if (a === '--json') out.json = true;
    else if (a === '--no-products') out.noProducts = true;
    else if (a.startsWith('--min-size=')) {
      const n = parseInt(a.split('=')[1], 10);
      if (Number.isFinite(n) && n >= 1) out.minSize = n;
    }
  }
  return out;
}

/** @param {import('mongoose').Types.ObjectId|null|undefined} id */
function idStr(id) {
  if (id == null) return '';
  return id.toString();
}

/**
 * @param {Array<{ processId?: unknown }>} processes
 * @param {boolean} ignoreOrder
 * @returns {{ key: string; ids: string[]; labels: string[]; chain: Array<{ step: number; processId: string; name: string; type: string }> }}
 */
function signatureFromProcesses(processes, ignoreOrder) {
  if (!Array.isArray(processes) || processes.length === 0) {
    return { key: '__empty__', ids: [], labels: [], chain: [] };
  }

  const pairs = [];
  for (const row of processes) {
    const pid = row?.processId;
    const oid =
      pid && typeof pid === 'object' && pid._id != null
        ? pid._id
        : pid;
    const sid = idStr(oid);
    if (!sid) continue;

    let name = '';
    let type = '';
    if (pid && typeof pid === 'object') {
      if (pid.name != null) name = String(pid.name);
      if (pid.type != null) type = String(pid.type);
    }
    const label = name ? `${name} (${sid.slice(-6)})` : sid;
    pairs.push({ id: sid, label, name, type });
  }

  let ordered = pairs;
  if (ignoreOrder) {
    const byId = new Map();
    for (const p of pairs) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    ordered = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  const ids = ordered.map((p) => p.id);
  const labels = ordered.map((p) => p.label);
  const chain = ordered.map((p, i) => ({
    step: i + 1,
    processId: p.id,
    name: p.name || '(no name)',
    type: p.type || '',
  }));
  const key = ids.length ? ids.join('>') : '__empty__';
  return { key, ids, labels, chain };
}

/**
 * How many products reference each processId anywhere in their chain (global, not per-group).
 * @param {Array<{ processes?: unknown[] }>} products
 */
function globalProcessReferenceCounts(products) {
  /** @type {Map<string, { processId: string; name: string; type: string; productCount: number }>} */
  const m = new Map();
  for (const p of products) {
    const { chain } = signatureFromProcesses(p.processes || [], false);
    const seen = new Set();
    for (const step of chain) {
      if (seen.has(step.processId)) continue;
      seen.add(step.processId);
      if (!m.has(step.processId)) {
        m.set(step.processId, {
          processId: step.processId,
          name: step.name,
          type: step.type,
          productCount: 0,
        });
      }
      m.get(step.processId).productCount += 1;
    }
  }
  return [...m.values()].sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  const products = await Product.find({})
    .select('name factoryCode softwareCode internalCode processes status')
    .populate({ path: 'processes.processId', select: 'name type' })
    .lean();

  /** @type {Map<string, Array<Record<string, unknown>>>} */
  const groups = new Map();

  for (const p of products) {
    const { key, ids, labels, chain } = signatureFromProcesses(p.processes || [], opts.ignoreOrder);
    const row = {
      _id: p._id.toString(),
      name: p.name || '',
      factoryCode: p.factoryCode || '',
      softwareCode: p.softwareCode || '',
      internalCode: p.internalCode || '',
      status: p.status || '',
      ids,
      labels,
      chain,
    };
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const entries = [...groups.entries()]
    .map(([key, list]) => ({ key, list, count: list.length }))
    .filter((g) => g.count >= opts.minSize)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const productsInReportedGroups = entries.reduce((s, g) => s + g.count, 0);
  const globalUsage = globalProcessReferenceCounts(products);

  if (opts.json) {
    const payload = {
      summary: {
        mode: opts.ignoreOrder ? 'ignore-order' : 'ordered-sequence',
        minGroupSize: opts.minSize,
        totalProductsInDb: products.length,
        groupsReported: entries.length,
        productsInReportedGroups,
        distinctProcessDocumentsReferenced: globalUsage.length,
      },
      processesReferencedByProductCount: globalUsage,
      groups: entries.map((g, idx) => {
        const chain = g.list[0]?.chain ?? [];
        return {
          groupIndex: idx + 1,
          processKey: g.key === '__empty__' ? null : g.key,
          stepCount: chain.length,
          productCount: g.count,
          processes: chain,
          products: opts.noProducts
            ? undefined
            : g.list.map(({ ids: _i, labels: _l, chain: _c, ...rest }) => rest),
        };
      }),
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload, null, 2));
  } else {
    const modeLabel = opts.ignoreOrder ? 'same set of processes (order ignored)' : 'same sequence (order matters)';
    // eslint-disable-next-line no-console
    console.log(
      `${'='.repeat(72)}\nSUMMARY\n${'='.repeat(72)}\n` +
        `Mode: ${modeLabel}\n` +
        `Total products in DB: ${products.length}\n` +
        `Groups shown (each group has ≥${opts.minSize} products): ${entries.length}\n` +
        `Products listed in those groups: ${productsInReportedGroups}\n` +
        `Distinct Process documents referenced (anywhere on a product): ${globalUsage.length}\n`
    );

    // eslint-disable-next-line no-console
    console.log(`${'-'.repeat(72)}\nProcesses by how many products use them (at least once in chain)\n${'-'.repeat(72)}`);
    for (const u of globalUsage) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${String(u.productCount).padStart(5)} products  |  ${u.name}  |  type=${u.type || '—'}  |  id=${u.processId}`
      );
    }

    let groupNum = 0;
    for (const g of entries) {
      groupNum += 1;
      const sample = g.list[0];
      const chain = sample?.chain ?? [];
      const title =
        g.key === '__empty__'
          ? '[no processes]'
          : (sample?.labels || []).join(' → ') || g.key;

      // eslint-disable-next-line no-console
      console.log(
        `\n${'='.repeat(72)}\nGROUP #${groupNum}  |  ${g.count} product(s)  |  ${chain.length} process step(s)\n` +
          `${title}\n${'='.repeat(72)}`
      );
      if (chain.length === 0) {
        // eslint-disable-next-line no-console
        console.log('  (no process steps on these products)');
      } else {
        // eslint-disable-next-line no-console
        console.log('Processes (in order for this group):');
        for (const step of chain) {
          const typePart = step.type ? `  type=${step.type}` : '';
          // eslint-disable-next-line no-console
          console.log(`  ${step.step}.  ${step.processId}  |  ${step.name}${typePart}`);
        }
      }

      if (!opts.noProducts) {
        // eslint-disable-next-line no-console
        console.log('\nProducts:');
        for (const pr of g.list) {
          const codes = [pr.factoryCode, pr.softwareCode, pr.internalCode].filter(Boolean).join(' | ');
          // eslint-disable-next-line no-console
          console.log(`  • ${pr.name}${codes ? `  (${codes})` : ''}  [${pr._id}]  status=${pr.status}`);
        }
      }
    }

    if (entries.length === 0) {
      // eslint-disable-next-line no-console
      console.log('\n(no groups met min-size; try --min-size=1)');
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
