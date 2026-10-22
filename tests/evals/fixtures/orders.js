import mongoose from "mongoose";
import { deriveOrderStatus } from "../../../src/ai/tools/deriveOrderStatus.js";
import {
  floorsPendingForArticle,
  roundPairs,
} from "../../../src/ai/tools/floorPending.js";
import { summarizeOrder } from "../../../src/ai/tools/orderStage.js";

/**
 * One floor bucket. `remaining` is stored and ignored by the tool.
 * @param {number} received
 * @param {number} transferred
 * @param {object} [extra]
 * @returns {object}
 */
function qty(received, transferred, extra) {
  return {
    received,
    transferred,
    completed: transferred,
    remaining: 0,
    ...(extra || {}),
  };
}

/**
 * @param {string} hex
 * @param {string} articleNumber
 * @param {string} status
 * @param {number} plannedQuantity
 * @param {object} floorQuantities
 * @returns {object}
 */
function article(hex, articleNumber, status, plannedQuantity, floorQuantities) {
  return {
    _id: new mongoose.Types.ObjectId(hex),
    articleNumber,
    status,
    plannedQuantity,
    floorQuantities,
  };
}

/**
 * Seven orders. Every number the tool returns is non-zero, so a spoken 0 is an invented number.
 * ORD-900101 checking pending is 19 and 6.5 on the articles, 25.5 on the order.
 * ORD-000456 and ORD-111456 share the suffix 456 so a partial lookup is ambiguous.
 * @type {object[]}
 */
export const evalOrders = [
  {
    _id: new mongoose.Types.ObjectId("65f0a1000000000000000001"),
    orderNumber: "ORD-900101",
    status: "Pending",
    articles: [
      article("65f0b1000000000000000001", "EA-01", "In Progress", 100, {
        knitting: qty(10.5, 0),
        warehouse: qty(18, 6),
      }),
      article("65f0b1000000000000000002", "EA-02", "In Progress", 80, {
        knitting: qty(8, 5),
        dispatch: qty(50, 30),
      }),
      article("65f0b1000000000000000003", "EA-03", "In Progress", 60, {
        linking: qty(9, 3),
      }),
      article("65f0b1000000000000000004", "EA-04", "In Progress", 40, {
        linking: qty(2.5, 0),
      }),
      article("65f0b1000000000000000005", "EA-05", "In Progress", 90, {
        checking: qty(25, 6, {
          m1Remaining: 2,
          m2Remaining: 4,
          m3Quantity: 3,
          m4Quantity: 1,
        }),
      }),
      article("65f0b1000000000000000006", "EA-06", "In Progress", 70, {
        checking: qty(10, 3.5, {
          m1Remaining: 1.5,
          m2Remaining: 2.5,
          m3Quantity: 1,
          m4Quantity: 2,
        }),
        warehouse: qty(9, 3.5),
      }),
      article("65f0b1000000000000000007", "EA-07", "In Progress", 50, {
        washing: qty(7, 0),
      }),
      article("65f0b1000000000000000008", "EA-08", "In Progress", 30, {
        boarding: qty(5, 1.5),
        reBoarding: qty(4, 0),
      }),
      article("65f0b1000000000000000009", "EA-09", "In Progress", 28, {
        silicon: qty(2, 0),
      }),
      article("65f0b100000000000000000a", "EA-10", "In Progress", 16, {
        secondaryChecking: qty(14, 6, {
          m1Remaining: 1,
          m2Remaining: 2,
          m3Quantity: 1.5,
          m4Quantity: 0.5,
        }),
      }),
      article("65f0b100000000000000000b", "EA-11", "In Progress", 14, {
        branding: qty(5, 0),
        dispatch: qty(36, 11.5),
      }),
      article("65f0b100000000000000000c", "EA-12", "In Progress", 11, {
        finalChecking: qty(7, 3.5, {
          m1Remaining: 0.5,
          m2Remaining: 1,
          m3Quantity: 1,
          m4Quantity: 1,
        }),
      }),
    ],
  },
  {
    _id: new mongoose.Types.ObjectId("65f0a1000000000000000002"),
    orderNumber: "ORD-900102",
    status: "Pending",
    articles: [
      article("65f0b2000000000000000001", "EB-01", "In Progress", 40, {
        knitting: qty(16, 4),
        warehouse: qty(8, 3),
      }),
      article("65f0b2000000000000000002", "EB-02", "In Progress", 48, {
        checking: qty(28.5, 17, {
          m1Remaining: 2,
          m2Remaining: 6.5,
          m3Quantity: 1,
          m4Quantity: 1.5,
        }),
      }),
      article("65f0b2000000000000000003", "EB-03", "In Progress", 24, {
        washing: qty(9, 5),
        dispatch: qty(14, 6),
      }),
    ],
  },
  {
    _id: new mongoose.Types.ObjectId("65f0a1000000000000000003"),
    orderNumber: "ORD-900103",
    status: "Pending",
    articles: [
      article("65f0b3000000000000000001", "EC-01", "On Hold", 18, {
        knitting: qty(9, 0),
      }),
      article("65f0b3000000000000000002", "EC-02", "In Progress", 22, {
        linking: qty(6, 1.5),
        warehouse: qty(2, 0),
        dispatch: qty(10, 7),
      }),
    ],
  },
  {
    _id: new mongoose.Types.ObjectId("65f0a1000000000000000004"),
    orderNumber: "ORD-000123",
    status: "Pending",
    articles: [
      article("65f0b4000000000000000001", "ED-01", "In Progress", 32, {
        knitting: qty(21, 0),
        warehouse: qty(4, 0),
        dispatch: qty(18, 13),
      }),
    ],
  },
  {
    _id: new mongoose.Types.ObjectId("65f0a1000000000000000005"),
    orderNumber: "ORD-000456",
    status: "Pending",
    articles: [
      article("65f0b5000000000000000001", "EE-01", "In Progress", 20, {
        knitting: qty(12, 0),
        warehouse: qty(3, 0),
        dispatch: qty(9, 4),
      }),
    ],
  },
  {
    _id: new mongoose.Types.ObjectId("65f0a1000000000000000006"),
    orderNumber: "ORD-111456",
    status: "Pending",
    articles: [
      article("65f0b6000000000000000001", "EF-01", "In Progress", 18, {
        knitting: qty(8, 2),
        warehouse: qty(5, 1),
        dispatch: qty(11, 7),
      }),
    ],
  },
  {
    _id: new mongoose.Types.ObjectId("65f0a1000000000000000064"),
    orderNumber: "ORD-000064",
    status: "Pending",
    articles: [
      article("65f0b1000000000000000064", "EF-64", "In Progress", 50, {
        knitting: qty(41.25, 0),
        warehouse: qty(6.25, 2),
        dispatch: qty(9.25, 3.25),
      }),
    ],
  },
];

/** Totals the cases file asserts. Derived from the same helpers the tool uses. */
const EXPECTED = {
  "ORD-900101": {
    derivedStatus: "In Progress",
    articleCount: 12,
    inProduction: 80.5,
    inWarehouse: 17.5,
    readyToDispatch: 44.5,
    dispatched: 41.5,
    checking: 25.5,
  },
  "ORD-900102": {
    derivedStatus: "In Progress",
    articleCount: 3,
    inProduction: 27.5,
    inWarehouse: 5,
    readyToDispatch: 8,
    dispatched: 6,
    checking: 11.5,
    m2Remaining: 6.5,
  },
  "ORD-900103": {
    derivedStatus: "On Hold",
    articleCount: 2,
    inProduction: 13.5,
    inWarehouse: 2,
    readyToDispatch: 3,
    dispatched: 7,
  },
  "ORD-000123": {
    derivedStatus: "In Progress",
    articleCount: 1,
    inProduction: 21,
    inWarehouse: 4,
    readyToDispatch: 5,
    dispatched: 13,
  },
  "ORD-000456": {
    derivedStatus: "In Progress",
    articleCount: 1,
    inProduction: 12,
    inWarehouse: 3,
    readyToDispatch: 5,
    dispatched: 4,
  },
  "ORD-111456": {
    derivedStatus: "In Progress",
    articleCount: 1,
    inProduction: 6,
    inWarehouse: 4,
    readyToDispatch: 4,
    dispatched: 7,
  },
  "ORD-000064": {
    derivedStatus: "In Progress",
    articleCount: 1,
    inProduction: 41.25,
    inWarehouse: 4.25,
    readyToDispatch: 6,
    dispatched: 3.25,
  },
};

/**
 * Tool-shaped numbers for one article. Same rounding as getProductionOrder.
 * @param {object} row
 * @returns {object}
 */
function presentedArticle(row) {
  const floors = floorsPendingForArticle(row.floorQuantities);
  return {
    plannedQuantity: roundPairs(row.plannedQuantity),
    floors: Object.fromEntries(
      Object.entries(floors).map(([key, floor]) => {
        const presented = { pending: roundPairs(floor.pending) };
        if (floor.grades) {
          presented.grades = {
            m1Remaining: roundPairs(floor.grades.m1Remaining),
            m2Remaining: roundPairs(floor.grades.m2Remaining),
            m3Quantity: roundPairs(floor.grades.m3Quantity),
            m4Quantity: roundPairs(floor.grades.m4Quantity),
          };
        }
        return [key, presented];
      })
    ),
  };
}

/**
 * Collects numeric leaves. A 0 here would let the model say "0" and still pass.
 * @param {unknown} node
 * @param {string} path
 * @param {string[]} zeros
 * @returns {void}
 */
function collectZeros(node, path, zeros) {
  if (typeof node === "number") {
    if (node === 0) zeros.push(path);
    return;
  }
  if (!node || typeof node !== "object") return;
  Object.entries(node).forEach(([key, child]) => {
    collectZeros(child, `${path}.${key}`, zeros);
  });
}

/**
 * Checks fixture math against the tool helpers before any LLM call.
 * @returns {object[]}
 */
export function assertEvalSnapshots() {
  return evalOrders.map((order) => {
    const summary = summarizeOrder(order.articles);
    const derivedStatus = deriveOrderStatus(
      order.articles.map((row) => row.status)
    );
    const presented = order.articles.map(presentedArticle);
    const zeros = [];
    collectZeros(summary, order.orderNumber, zeros);
    presented.forEach((row, index) => {
      collectZeros(row, `${order.orderNumber}.article${index}`, zeros);
    });
    if (zeros.length) {
      throw new Error(
        `Eval fixture contains 0, which would hide invented zeros: ${zeros.join(
          ", "
        )}`
      );
    }
    const expected = EXPECTED[order.orderNumber];
    const actual = {
      derivedStatus,
      articleCount: order.articles.length,
      ...summary.orderSummary,
      checking: summary.orderTotals.checking,
      m2Remaining: presented
        .map((row) => row.floors.checking?.grades?.m2Remaining)
        .find((value) => typeof value === "number"),
    };
    Object.entries(expected).forEach(([key, value]) => {
      if (actual[key] !== value) {
        throw new Error(
          `${order.orderNumber}.${key}: expected ${value}, got ${actual[key]}`
        );
      }
    });
    return {
      orderNumber: order.orderNumber,
      derivedStatus,
      articleCount: order.articles.length,
      orderSummary: summary.orderSummary,
      orderTotals: summary.orderTotals,
    };
  });
}
