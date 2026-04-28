import { promises as fs } from 'node:fs';

/**
 * Parse CLI args in the form:
 * --file=./a644.json --value=1166 [--write] [--all]
 *
 * @param {string[]} argv process.argv
 * @returns {{ file: string, value: number, write: boolean, all: boolean }}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const fileArg = args.find((a) => a.startsWith('--file='));
  const valueArg = args.find((a) => a.startsWith('--value='));
  const write = args.includes('--write');
  const all = args.includes('--all');

  const file = fileArg ? fileArg.slice('--file='.length) : './a644.json';
  const valueRaw = valueArg ? valueArg.slice('--value='.length) : '1166';
  const value = Number(valueRaw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid --value: ${valueRaw}`);
  }

  return { file, value, write, all };
}

/**
 * @param {unknown} data Parsed JSON data
 * @param {number} value New quantity value
 * @param {{ all: boolean }} opts Options
 * @returns {{ updatedCount: number, updatedPaths: string[] }}
 */
function updateKnittingQuantities(data, value, opts) {
  /** @type {string[]} */
  const updatedPaths = [];

  if (!data || typeof data !== 'object') {
    throw new Error('JSON root is not an object.');
  }

  // @ts-ignore - runtime checks below
  const matchedArticles = data.matchedArticles;
  if (!Array.isArray(matchedArticles)) {
    throw new Error('Expected `matchedArticles` to be an array.');
  }

  const targets = opts.all ? matchedArticles : matchedArticles.slice(0, 1);

  targets.forEach((article, idx) => {
    if (!article || typeof article !== 'object') return;

    // @ts-ignore - runtime checks below
    const floorQuantities = article.floorQuantities;
    if (!floorQuantities || typeof floorQuantities !== 'object') return;

    // @ts-ignore - runtime checks below
    const knitting = floorQuantities.knitting;
    if (!knitting || typeof knitting !== 'object') return;

    // @ts-ignore - runtime assignment
    knitting.completed = value;
    // @ts-ignore - runtime assignment
    knitting.transferred = value;

    const articleIndex = opts.all ? idx : 0;
    updatedPaths.push(`matchedArticles[${articleIndex}].floorQuantities.knitting.completed`);
    updatedPaths.push(`matchedArticles[${articleIndex}].floorQuantities.knitting.transferred`);
  });

  return { updatedCount: updatedPaths.length / 2, updatedPaths };
}

/**
 * @param {string} filePath
 * @returns {Promise<{ raw: string, data: unknown }>}
 */
async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const data = JSON.parse(raw);
  return { raw, data };
}

/**
 * @param {string} filePath
 * @param {string} rawJson
 * @returns {Promise<string>} backup path
 */
async function writeBackup(filePath, rawJson) {
  const backupPath = `${filePath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await fs.writeFile(backupPath, rawJson, 'utf8');
  return backupPath;
}

/**
 * @param {string} filePath
 * @param {unknown} data
 * @returns {Promise<void>}
 */
async function writeJsonPretty(filePath, data) {
  const out = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(filePath, out, 'utf8');
}

async function main() {
  const { file, value, write, all } = parseArgs(process.argv);

  const { raw, data } = await readJson(file);
  const { updatedCount, updatedPaths } = updateKnittingQuantities(data, value, { all });

  if (updatedCount === 0) {
    throw new Error(
      'No knitting quantities updated. Expected at least one `matchedArticles[*].floorQuantities.knitting` object.',
    );
  }

  if (!write) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          file,
          value,
          all,
          updatedCount,
          updatedPaths,
          hint: 'Run again with --write to persist changes.',
        },
        null,
        2,
      ),
    );
    return;
  }

  const backupPath = await writeBackup(file, raw);
  await writeJsonPretty(file, data);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      { ok: true, dryRun: false, file, backupPath, value, all, updatedCount, updatedPaths },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack || err);
  process.exitCode = 1;
});
