#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import mongoose from "mongoose";

import { completeChatTurn } from "../src/ai/chat.service.js";
import {
  chatModelId,
  chatReasoningEffort,
  PROMPT_VERSION,
  REASONING_EFFORTS,
} from "../src/ai/loadSystemPrompt.js";
import config from "../src/config/config.js";
import { redactMongoUri } from "../src/config/mongoUri.js";
import { addUsage, cacheSavingsUsd, estimateCostUsd } from "../tests/evals/lib/cost.js";
import { assertGradeSelfCheck } from "../tests/evals/lib/gradeSelfCheck.js";
import { gradeRun } from "../tests/evals/lib/gradeRun.js";
import { databaseName, toLocalTestUrl } from "../tests/evals/lib/testDb.js";
import seedEvalData from "../tests/evals/fixtures/seedEvalData.js";

const here = dirname(fileURLToPath(import.meta.url));
const casesPath = join(here, "../tests/evals/cases/production.json");
const resultsDir = join(here, "../tests/evals/results");

/**
 * Effort for this run. `--reasoning` pins one. Otherwise the live chat effort is used.
 * @param {{ model: string, reasoning: string|null }} options
 * @returns {string|null}
 */
function effortForRun(options) {
  if (options.reasoning) return options.reasoning;
  return chatReasoningEffort(options.model);
}

/**
 * @param {string[]} argv
 * @returns {{ model: string, runs: number, caseId: string|null, reasoning: string|null }}
 */
function parseArgs(argv) {
  const options = { model: chatModelId(), runs: 5, caseId: null, reasoning: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--model") {
      options.model = next;
      index += 1;
    } else if (arg === "--runs") {
      options.runs = Number(next);
      index += 1;
    } else if (arg === "--case") {
      options.caseId = next;
      index += 1;
    } else if (arg === "--reasoning") {
      options.reasoning = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  if (options.reasoning && !REASONING_EFFORTS.includes(options.reasoning)) {
    throw new Error(`--reasoning must be one of ${REASONING_EFFORTS.join(", ")}`);
  }
  if (!options.model || !String(options.model).trim())
    throw new Error("--model is empty");
  if (!Number.isInteger(options.runs) || options.runs < 1)
    throw new Error("--runs must be a positive integer");
  return options;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Nearest-rank percentile. p=95 on 10 values is the last one.
 * @param {number[]} values
 * @param {number} p
 * @returns {number}
 */
function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index];
}

/**
 * USD per graded question, rounded to 6 decimals. Null when the model has no price.
 * @param {number|null} costUsd
 * @param {number} questions
 * @returns {number|null}
 */
function costPerQuestion(costUsd, questions) {
  if (costUsd == null || questions === 0) return null;
  return Math.round((costUsd / questions) * 1e6) / 1e6;
}

/**
 * @param {string|null|undefined} error
 * @returns {boolean}
 */
function isRateLimit(error) {
  return /429|rate limit|overloaded/i.test(String(error || ""));
}

/**
 * @param {string|null} caseId
 * @returns {object[]}
 */
function loadCases(caseId) {
  const cases = JSON.parse(readFileSync(casesPath, "utf8"));
  const required = [
    "id",
    "user",
    "question",
    "language",
    "expectTools",
    "mustContain",
    "mustNotContain",
    "expectRefusal",
  ];
  cases.forEach((testCase) => {
    required.forEach((key) => {
      if (!(key in testCase))
        throw new Error(`Case ${testCase.id || "?"} is missing ${key}`);
    });
    if (testCase.language !== "en" && testCase.language !== "hinglish") {
      throw new Error(`Case ${testCase.id} language must be en or hinglish`);
    }
  });
  if (!caseId) return cases;
  const selected = cases.filter((testCase) => testCase.id === caseId);
  if (selected.length === 0) throw new Error(`No case with id ${caseId}`);
  return selected;
}

/**
 * One chat turn, retried when the provider rate-limits.
 * @param {{ id: unknown, navigation: object }} user
 * @param {object} testCase
 * @param {string} model
 * @param {string|null} reasoning
 * @returns {Promise<object>}
 */
async function runWithRetry(user, testCase, model, reasoning) {
  let latest = null;
  const attempts = [1, 2, 3];
  await attempts.reduce(async (previous, attempt) => {
    await previous;
    if (latest && !isRateLimit(latest.error)) return;
    if (attempt > 1) {
      console.log(`rate limit on ${testCase.id}, retry ${attempt}`);
      await sleep(4000 * (attempt - 1));
    }
    latest = await completeChatTurn({
      user,
      modelId: model,
      reasoningEffort: reasoning,
      messages: [
        {
          id: `${testCase.id}-r${attempt}`,
          role: "user",
          parts: [{ type: "text", text: testCase.question }],
        },
      ],
    });
  }, Promise.resolve());
  return latest;
}

/**
 * @param {object[]} cases
 * @param {Record<string, { id: unknown, navigation: object }>} users
 * @param {{ model: string, runs: number }} options
 * @returns {Promise<object>}
 */
async function runAll(cases, users, options) {
  const caseReports = [];
  let usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
  };
  let latencySum = 0;
  let latencyCount = 0;
  const latencies = [];

  await cases.reduce(async (previousCase, testCase) => {
    await previousCase;
    const user = users[testCase.user];
    if (!user)
      throw new Error(
        `Case ${testCase.id} user ${testCase.user} was not seeded`
      );
    const runs = [];
    const indexes = Array.from(
      { length: options.runs },
      (_, index) => index + 1
    );
    await indexes.reduce(async (previousRun, runNumber) => {
      await previousRun;
      const result = await runWithRetry(user, testCase, options.model, options.reasoning);
      const grade = gradeRun(testCase, result);
      usage = addUsage(usage, result.tokens);
      const latencyMs = result.latencyMs || 0;
      latencySum += latencyMs;
      latencyCount += 1;
      latencies.push(latencyMs);
      runs.push({
        run: runNumber,
        pass: grade.pass,
        failures: grade.failures,
        answer: result.answer,
        toolCalls: result.toolCalls,
        tokens: result.tokens,
        error: result.error,
        latencyMs: result.latencyMs,
      });
      const mark = grade.pass ? "pass" : "fail";
      console.log(
        `${testCase.id} ${runNumber}/${options.runs} ${mark}${
          grade.pass ? "" : ` — ${grade.failures.join("; ")}`
        }`
      );
    }, Promise.resolve());
    caseReports.push({
      id: testCase.id,
      passed: runs.filter((run) => run.pass).length,
      runs: runs.length,
      results: runs,
    });
  }, Promise.resolve());

  const costUsd = estimateCostUsd(options.model, usage);
  const savingsUsd = cacheSavingsUsd(options.model, usage);
  return {
    model: options.model,
    promptVersion: PROMPT_VERSION,
    reasoningEffort: effortForRun(options),
    runs: options.runs,
    usage,
    costUsd,
    cacheSavingsUsd: savingsUsd,
    costPerQuestionUsd: costPerQuestion(costUsd, latencyCount),
    avgLatencyMs: latencyCount === 0 ? 0 : Math.round(latencySum / latencyCount),
    p95LatencyMs: percentile(latencies, 95),
    cases: caseReports,
  };
}

/**
 * @param {object} report
 * @returns {void}
 */
function printReport(report) {
  const width = report.cases.reduce(
    (max, row) => Math.max(max, row.id.length),
    4
  );
  console.log(`\n${report.model}`);
  console.log(`${"case".padEnd(width)}  pass`);
  report.cases.forEach((row) => {
    console.log(`${row.id.padEnd(width)}  ${row.passed}/${row.runs}`);
  });
  const passed = report.cases.reduce((sum, row) => sum + row.passed, 0);
  const total = report.cases.reduce((sum, row) => sum + row.runs, 0);
  const rate = total === 0 ? 0 : Math.round((passed / total) * 1000) / 10;
  console.log(`overall ${passed}/${total} (${rate}%)`);
  console.log(
    `tokens in ${report.usage.inputTokens} out ${report.usage.outputTokens} total ${report.usage.totalTokens} cached ${report.usage.cachedInputTokens}`
  );
  console.log(
    report.costUsd == null
      ? "estimated cost unknown"
      : `estimated cost $${report.costUsd.toFixed(6)}`
  );
  console.log(
    report.costPerQuestionUsd == null
      ? "cost per question unknown"
      : `cost per question $${report.costPerQuestionUsd.toFixed(6)}`
  );
  console.log(
    report.cacheSavingsUsd == null
      ? "cache savings unknown"
      : `cache savings $${report.cacheSavingsUsd.toFixed(6)}`
  );
  console.log(
    `average latency ${report.avgLatencyMs} ms  p95 ${report.p95LatencyMs} ms`
  );
}

/**
 * @param {object} report
 * @returns {string}
 */
function writeResults(report) {
  mkdirSync(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeModel = String(report.model).replace(/[^a-zA-Z0-9._-]/g, "_");
  const effort = report.reasoningEffort ? `-${report.reasoningEffort}` : "";
  const filePath = join(resultsDir, `${stamp}-${safeModel}${effort}.json`);
  writeFileSync(filePath, JSON.stringify(report, null, 2));
  console.log(`wrote ${filePath}`);
  return filePath;
}

/**
 * Seeds the local -test database and grades real chat turns.
 * @returns {Promise<void>}
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertGradeSelfCheck();
  const testUrl = toLocalTestUrl(config.mongoose.url);
  const name = databaseName(testUrl);
  if (!name.endsWith("-test")) throw new Error(`Refusing database ${name}`);
  console.log(`eval database ${name} (${redactMongoUri(testUrl)})`);
  const reasoning = effortForRun(options);
  console.log(
    `model ${options.model} runs ${options.runs} prompt ${PROMPT_VERSION} reasoning ${
      reasoning || "off"
    }`
  );
  await mongoose.connect(testUrl, config.mongoose.options);
  try {
    const seeded = await seedEvalData();
    seeded.snapshots.forEach((row) => {
      console.log(
        `seeded ${row.orderNumber} derived ${row.derivedStatus} articles ${row.articleCount} inProduction ${row.orderSummary.inProduction}`
      );
    });
    const report = await runAll(
      loadCases(options.caseId),
      seeded.users,
      options
    );
    writeResults(report);
    printReport(report);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
