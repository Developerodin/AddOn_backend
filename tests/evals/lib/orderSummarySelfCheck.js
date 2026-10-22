import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gradeRun } from "./gradeRun.js";

const casesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../cases/production.json"
);

const FLOOR_NAMES = [
  "Knitting",
  "Linking",
  "Checking",
  "Washing",
  "Boarding",
  "Silicon",
  "Secondary Checking",
  "Branding",
  "Re-Boarding",
  "Final Checking",
];

/**
 * @returns {object[]}
 */
function loadEvalCases() {
  return JSON.parse(readFileSync(casesPath, "utf8"));
}

/**
 * @param {object[]} cases
 * @param {string} id
 * @returns {object}
 */
function evalCase(cases, id) {
  const found = cases.find((row) => row.id === id);
  if (!found) throw new Error(`eval case ${id} is missing`);
  return found;
}

/**
 * @param {object} testCase
 * @param {string[]} needles
 * @returns {void}
 */
function requireNeedles(testCase, needles) {
  needles
    .filter((needle) => !testCase.mustContain.includes(needle))
    .forEach((needle) => {
      throw new Error(`${testCase.id} must require "${needle}"`);
    });
}

/**
 * @param {object} testCase
 * @param {string[]} needles
 * @returns {void}
 */
function forbidNeedles(testCase, needles) {
  needles
    .filter((needle) => testCase.mustContain.includes(needle))
    .forEach((needle) => {
      throw new Error(`${testCase.id} must not require "${needle}"`);
    });
}

/**
 * Floors require the floor list plus inProduction. Full orderSummary is status-only.
 * @param {object[]} cases
 * @returns {void}
 */
function assertSummarySpec(cases) {
  const floors = evalCase(cases, "floors-hinglish");
  requireNeedles(floors, ["80.5", "pair"].concat(FLOOR_NAMES));
  forbidNeedles(floors, ["17.5", "44.5", "41.5"]);
  requireNeedles(evalCase(cases, "status-en"), ["In Progress", "27.5", "5", "8", "6"]);
  requireNeedles(evalCase(cases, "on-hold"), ["On Hold", "13.5", "2", "3", "7"]);
  requireNeedles(evalCase(cases, "partial-123"), ["ORD-000123", "21", "4", "5", "13"]);
  forbidNeedles(evalCase(cases, "checking-total"), ["80.5", "17.5", "44.5", "41.5"]);
  forbidNeedles(evalCase(cases, "qc-m2"), ["27.5", "5", "8", "6"]);
}

/**
 * @param {object} testCase
 * @param {object} run
 * @param {string} label
 * @returns {void}
 */
function gradeOrThrow(testCase, run, label) {
  const graded = gradeRun(testCase, run);
  if (!graded.pass) throw new Error(`${label}: ${graded.failures.join("; ")}`);
}

/**
 * A floor reply that states floors and inProduction passes without the other totals.
 * @param {object[]} cases
 * @returns {void}
 */
function assertFloorSummaryGrade(cases) {
  gradeOrThrow(
    evalCase(cases, "floors-hinglish"),
    {
      answer:
        "ORD-900101 me Knitting 13.5 pair, Linking 8.5 pair, Checking 25.5 pair, Washing 7 pair, Boarding 3.5 pair, Silicon 2 pair, Secondary Checking 8 pair, Branding 5 pair, Re-Boarding 4 pair, Final Checking 3.5 pair. In production 80.5 pair.",
      toolCalls: [
        {
          name: "getProductionOrder",
          output: {
            orderNumber: "ORD-900101",
            orderSummary: {
              inProduction: 80.5,
              inWarehouse: 17.5,
              readyToDispatch: 44.5,
              dispatched: 41.5,
            },
            orderTotals: {
              knitting: 13.5,
              linking: 8.5,
              checking: 25.5,
              washing: 7,
              boarding: 3.5,
              silicon: 2,
              secondaryChecking: 8,
              branding: 5,
              reBoarding: 4,
              finalChecking: 3.5,
            },
          },
        },
      ],
      error: null,
    },
    "floors plus inProduction"
  );
}

/**
 * A status line with no totals fails. The same reply with all four totals passes.
 * @param {object[]} cases
 * @returns {void}
 */
function assertStatusEnGrade(cases) {
  const status = evalCase(cases, "status-en");
  const statusCalls = [
    {
      name: "getProductionOrder",
      output: {
        orderNumber: "ORD-900102",
        derivedStatus: "In Progress",
        orderSummary: {
          inProduction: 27.5,
          inWarehouse: 5,
          readyToDispatch: 8,
          dispatched: 6,
        },
      },
    },
  ];
  const thin = gradeRun(status, {
    answer: "Order ORD-900102 is In Progress.",
    toolCalls: statusCalls,
    error: null,
  });
  if (thin.pass || !thin.failures.some((line) => line.includes('missing "27.5"'))) {
    throw new Error("status without orderSummary passed");
  }
  gradeOrThrow(
    status,
    {
      answer:
        "ORD-900102 is In Progress. 27.5 pairs in production, 5 in the warehouse, 8 ready to dispatch, 6 dispatched.",
      toolCalls: statusCalls,
      error: null,
    },
    "status with orderSummary"
  );
}

/**
 * On-hold and partial status need the four totals. A single-floor question does not.
 * @param {object[]} cases
 * @returns {void}
 */
function assertOtherSummaryGrades(cases) {
  gradeOrThrow(
    evalCase(cases, "on-hold"),
    {
      answer:
        "ORD-900103 is On Hold. 13.5 pairs in production, 2 in the warehouse, 3 ready to dispatch, 7 dispatched.",
      toolCalls: [
        {
          name: "getProductionOrder",
          output: {
            orderNumber: "ORD-900103",
            derivedStatus: "On Hold",
            orderSummary: {
              inProduction: 13.5,
              inWarehouse: 2,
              readyToDispatch: 3,
              dispatched: 7,
            },
          },
        },
      ],
      error: null,
    },
    "on-hold with orderSummary"
  );
  gradeOrThrow(
    evalCase(cases, "partial-123"),
    {
      answer:
        "Opened ORD-000123 for 123. In Progress. 21 pairs in production, 4 in the warehouse, 5 ready to dispatch, 13 dispatched.",
      toolCalls: [
        {
          name: "getProductionOrder",
          output: {
            matchedFrom: "123",
            orderNumber: "ORD-000123",
            derivedStatus: "In Progress",
            orderSummary: {
              inProduction: 21,
              inWarehouse: 4,
              readyToDispatch: 5,
              dispatched: 13,
            },
          },
        },
      ],
      error: null,
    },
    "partial-123 with orderSummary"
  );
  gradeOrThrow(
    evalCase(cases, "checking-total"),
    {
      answer: "Checking has 25.5 pairs.",
      toolCalls: [
        {
          name: "getProductionOrder",
          output: {
            orderNumber: "ORD-900101",
            orderTotals: { checking: 25.5 },
            orderSummary: {
              inProduction: 80.5,
              inWarehouse: 17.5,
              readyToDispatch: 44.5,
              dispatched: 41.5,
            },
          },
        },
      ],
      error: null,
    },
    "checking without full orderSummary"
  );
}

/**
 * Locks the floors-vs-status orderSummary rule to the case file and the grader.
 * @returns {void}
 */
export function assertOrderSummaryRule() {
  const cases = loadEvalCases();
  assertSummarySpec(cases);
  assertFloorSummaryGrade(cases);
  assertStatusEnGrade(cases);
  assertOtherSummaryGrades(cases);
}
