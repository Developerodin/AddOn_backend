import { extractNumbers, gradeRun } from "./gradeRun.js";
import { assertOrderSummaryRule } from "./orderSummarySelfCheck.js";
import { assertRefusalQuestionLabels } from "./refusalSelfCheck.js";
import assertWarehouseGradeSelfCheck from "./warehouseGradeSelfCheck.js";

/**
 * Throws if the number check would miss an invented zero or punish a real total.
 * @returns {void}
 */
export function assertGradeSelfCheck() {
  const toolCalls = [
    {
      name: "getProductionOrder",
      output: {
        orderNumber: "ORD-000123",
        orderTotals: { checking: 22.5 },
        orderSummary: { inProduction: 80.5, inWarehouse: 17.5 },
      },
    },
  ];
  const base = {
    language: "en",
    expectTools: ["getProductionOrder"],
    mustContain: [],
    mustNotContain: [],
    expectRefusal: false,
  };
  const invented = gradeRun(base, {
    answer: "Final Checking 0 pairs",
    toolCalls,
    error: null,
  });
  if (
    invented.pass ||
    !invented.failures.some((line) =>
      line.includes("number not in tool output")
    )
  ) {
    throw new Error("number check did not catch an invented 0");
  }
  const real = gradeRun(
    { ...base, mustContain: ["22.5"] },
    {
      answer: "Checking 22.50 pairs. Order ORD-000123.",
      toolCalls,
      error: null,
    }
  );
  if (!real.pass)
    throw new Error(
      `number check rejected a real total: ${real.failures.join("; ")}`
    );
  const suffix = gradeRun(
    { ...base, mustNotContain: ["7.5"] },
    { answer: "Warehouse 17.5 pairs", toolCalls, error: null }
  );
  if (!suffix.pass)
    throw new Error(
      `7.5 was treated as inside 17.5: ${suffix.failures.join("; ")}`
    );
  const article = gradeRun(
    { ...base, mustNotContain: ["7.5"] },
    { answer: "Checking 7.5 pairs", toolCalls, error: null }
  );
  if (article.pass) throw new Error("standalone 7.5 was allowed");
  const refusal = gradeRun(
    { ...base, expectTools: [], expectRefusal: true },
    { answer: "About 12 kg", toolCalls: [], error: null }
  );
  if (refusal.pass) throw new Error("refusal with a number passed");
  const exampleRefusal = gradeRun(
    {
      ...base,
      expectTools: [],
      expectRefusal: true,
      mustNotContain: ["ORD-000123", "80.5"],
    },
    {
      answer: "I can't do that. For example 123 or ORD-000123.",
      toolCalls: [],
      error: null,
    }
  );
  if (!exampleRefusal.pass) {
    throw new Error(`schema example refusal failed: ${exampleRefusal.failures.join("; ")}`);
  }
  const mixedRefusal = gradeRun(
    { ...base, expectTools: [], expectRefusal: true },
    { answer: "Example 123, but also 80.5 pairs", toolCalls: [], error: null }
  );
  if (mixedRefusal.pass) throw new Error("refusal leaked a non-example number");
  assertRefusalQuestionLabels();
  const singular = gradeRun(
    { ...base, mustContain: ["pairs"], mustNotContain: ["pairs"] },
    { answer: "Checking 22.50 pair. Order ORD-000123.", toolCalls, error: null }
  );
  if (!singular.pass) {
    throw new Error(`singular pair was rejected: ${singular.failures.join("; ")}`);
  }
  const pluralForbidden = gradeRun(
    { ...base, language: "hinglish", mustContain: ["pair"], mustNotContain: ["pairs"] },
    { answer: "Checking mein 22.50 pairs hai", toolCalls, error: null }
  );
  if (pluralForbidden.pass) throw new Error("forbidden pairs was allowed via pair");
  const englishHindi = gradeRun(base, {
    answer: "Checking 22.50 pairs hai",
    toolCalls,
    error: null,
  });
  if (
    englishHindi.pass ||
    !englishHindi.failures.some((line) => line.includes("Hinglish"))
  ) {
    throw new Error("English reply in Hinglish was allowed");
  }
  const bareNotFound = gradeRun(base, {
    answer: "That order was not found",
    toolCalls,
    error: null,
  });
  if (
    bareNotFound.pass ||
    !bareNotFound.failures.some((line) => line.includes("toolCalledBeforeNotFound"))
  ) {
    throw new Error("not found without NOT_FOUND was allowed");
  }
  const nahiMila = gradeRun(base, {
    answer: "Order nahi mila",
    toolCalls,
    error: null,
  });
  if (
    nahiMila.pass ||
    !nahiMila.failures.some((line) => line.includes("toolCalledBeforeNotFound"))
  ) {
    throw new Error("nahi mila without NOT_FOUND was allowed");
  }
  const toolNotFound = gradeRun(base, {
    answer: "EVAL-NONE was not found",
    toolCalls: [{ name: "getProductionOrder", output: { error: "NOT_FOUND" } }],
    error: null,
  });
  if (!toolNotFound.pass) {
    throw new Error(`NOT_FOUND reply failed: ${toolNotFound.failures.join("; ")}`);
  }
  const labels = extractNumbers("Checking 22.50 pairs. Order ORD-000123. Article EA-11.");
  if (labels.some((value) => value === 123 || value === 11) || !labels.includes(22.5)) {
    throw new Error(`identifier digits were counted: ${labels.join(", ")}`);
  }
  const fromArticleId = gradeRun(base, {
    answer: "Checking 11 pairs",
    toolCalls: [
      {
        name: "getProductionOrder",
        output: {
          orderNumber: "ORD-000123",
          articleCount: 12,
          articles: [{ articleNumber: "EA-11", status: "In Progress" }],
          orderTotals: { checking: 22.5 },
          orderSummary: { inProduction: 80.5, inWarehouse: 17.5 },
        },
      },
    ],
    error: null,
  });
  if (
    fromArticleId.pass ||
    !fromArticleId.failures.some((line) => line.includes("number not in tool output"))
  ) {
    throw new Error("11 from article id EA-11 was allowed");
  }
  const bareOrderNumber = gradeRun(base, {
    answer: "456 pairs",
    toolCalls: [
      {
        name: "getProductionOrder",
        output: { error: "AMBIGUOUS", candidates: ["ORD-000456", "ORD-111456"] },
      },
    ],
    error: null,
  });
  if (bareOrderNumber.pass) throw new Error("456 from an order number was allowed");
  const articleTotal = gradeRun(base, {
    answer: "In Progress. This order has 3 articles.",
    toolCalls: [
      {
        name: "getProductionOrder",
        output: {
          orderNumber: "ORD-900102",
          articleCount: 3,
          articles: [{ articleNumber: "EA-11" }],
          orderSummary: { inProduction: 27.5 },
        },
      },
    ],
    error: null,
  });
  if (!articleTotal.pass) {
    throw new Error(`articleCount was rejected: ${articleTotal.failures.join("; ")}`);
  }
  const echoed = gradeRun(
    {
      ...base,
      question: "What is the status of order 456",
      mustContain: ["ORD-000456", "ORD-111456", "which"],
    },
    {
      answer: "456 matches ORD-000456 and ORD-111456. Which one?",
      toolCalls: [
        {
          name: "getProductionOrder",
          output: { error: "AMBIGUOUS", candidates: ["ORD-000456", "ORD-111456"] },
        },
      ],
      error: null,
    }
  );
  if (!echoed.pass) {
    throw new Error(`echoed order digits were rejected: ${echoed.failures.join("; ")}`);
  }
  const pendingPairs = gradeRun(
    { ...base, mustContain: ["On Hold"], mustNotContain: ["piece", "stored"] },
    {
      answer: "ORD-900103 is On Hold. 13.5 pending pairs still in production.",
      toolCalls: [
        {
          name: "getProductionOrder",
          output: {
            orderNumber: "ORD-900103",
            derivedStatus: "On Hold",
            storedStatus: "Pending",
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
    }
  );
  if (!pendingPairs.pass) {
    throw new Error(`pending pairs was treated as stored status: ${pendingPairs.failures.join("; ")}`);
  }
  ["status is Pending", "stored status is On Hold", "stored: Pending"].forEach((answer) => {
    const graded = gradeRun(base, { answer, toolCalls, error: null });
    if (graded.pass || !graded.failures.some((line) => line.includes("stored-status"))) {
      throw new Error(`stored-status phrasing was allowed: ${answer}`);
    }
  });
  const eitherUnit = gradeRun(
    { ...base, language: "hinglish", mustContain: ["pair"] },
    { answer: "Checking mein 22.50 pairs hai", toolCalls, error: null }
  );
  if (!eitherUnit.pass) {
    throw new Error(`pairs was rejected for a pair requirement: ${eitherUnit.failures.join("; ")}`);
  }
  const closer = gradeRun(
    { ...base, language: "hinglish" },
    {
      answer: "ORD-900101 me 80.5 pairs. Chahe to bhi de sakta hoon. Chaho toh batao.",
      toolCalls,
      error: null,
    }
  );
  if (!closer.pass) {
    throw new Error(`hinglish closer rejected: ${closer.failures.join("; ")}`);
  }
  const onlyMe = gradeRun(
    { ...base, language: "hinglish" },
    { answer: "ORD-900101 me 80.5 pairs.", toolCalls, error: null }
  );
  if (!onlyMe.pass) {
    throw new Error(`hinglish "me" was rejected: ${onlyMe.failures.join("; ")}`);
  }
  const letMe = gradeRun(base, {
    answer: "Checking 22.50 pairs. Let me know if you want more.",
    toolCalls,
    error: null,
  });
  if (!letMe.pass) {
    throw new Error(`English pronoun "me" was treated as Hinglish: ${letMe.failures.join("; ")}`);
  }
  const yarnKg = gradeRun(
    { ...base, expectTools: ["getYarnLiveStock"], mustContain: ["12.5", "kg"] },
    {
      answer: "2/40s-Black has 12.5 kg available.",
      toolCalls: [
        {
          name: "getYarnLiveStock",
          output: {
            yarnName: "2/40s-Black-Black-Cotton/Giza Cotton",
            totalKg: 12.5,
            availableKg: 12.5,
            unit: "kg",
            counts: ["30s", "2/40s"],
          },
        },
      ],
      error: null,
    }
  );
  if (!yarnKg.pass) {
    throw new Error(`yarn kg from the tool was rejected: ${yarnKg.failures.join("; ")}`);
  }
  const yarnLabel = gradeRun(
    { ...base, expectTools: ["getYarnLiveStock"] },
    {
      answer: "Which count: 30s or 2/40s?",
      toolCalls: [
        {
          name: "getYarnLiveStock",
          output: { error: "TOO_MANY", count: 12, counts: ["30s", "2/40s"], colours: ["Black"] },
        },
      ],
      error: null,
    }
  );
  if (!yarnLabel.pass) {
    throw new Error(`yarn count labels were treated as quantities: ${yarnLabel.failures.join("; ")}`);
  }
  const inventedKg = gradeRun(
    { ...base, expectTools: ["getYarnLiveStock"] },
    {
      answer: "About 99 kg.",
      toolCalls: [
        {
          name: "getYarnLiveStock",
          output: { yarnName: "2/40s-Black-Black-Cotton/Giza Cotton", totalKg: 12.5 },
        },
      ],
      error: null,
    }
  );
  if (inventedKg.pass || !inventedKg.failures.some((line) => line.includes("number not in tool output"))) {
    throw new Error("invented yarn kg was allowed");
  }
  const yarnBuckets = gradeRun(
    { ...base, expectTools: ["getYarnLiveStock"], mustContain: ["kg"] },
    {
      answer:
        "Long-term 1.25 kg, short-term 2.5 kg, unallocated 0.75 kg, blocked 0.5 kg, available 3.25 kg, total 3.75 kg, stock map 9.5 kg, 8 cones.",
      toolCalls: [
        {
          name: "getYarnLiveStock",
          output: {
            yarnName: "2/40s-Black-Black-Cotton/Giza Cotton",
            unit: "kg",
            longTermKg: 1.25,
            shortTermKg: 2.5,
            unallocatedKg: 0.75,
            blockedKg: 0.5,
            availableKg: 3.25,
            totalKg: 3.75,
            totalStockKg: 9.5,
            cones: 8,
          },
        },
      ],
      error: null,
    }
  );
  if (!yarnBuckets.pass) {
    throw new Error(`yarn kg buckets were rejected: ${yarnBuckets.failures.join("; ")}`);
  }
  const yarnCombined = gradeRun(
    { ...base, expectTools: ["getYarnLiveStock"], mustContain: ["kg"] },
    {
      answer: "Giza 13.75 kg and Combed 8 kg. Combined total 21.75 kg, available 20.5 kg.",
      toolCalls: [
        {
          name: "getYarnLiveStock",
          output: {
            error: "AMBIGUOUS",
            candidates: [
              {
                yarnName: "2/40s-Black-Black-Cotton/Giza Cotton",
                totalKg: 13.75,
                availableKg: 13.75,
              },
              { yarnName: "40s-Black-Black-Cotton/Combed", totalKg: 8, availableKg: 6.75 },
            ],
            combinedTotalKg: 21.75,
            combinedAvailableKg: 20.5,
          },
        },
      ],
      error: null,
    }
  );
  if (!yarnCombined.pass) {
    throw new Error(`combined yarn kg was rejected: ${yarnCombined.failures.join("; ")}`);
  }
  const yarnMatchCount = gradeRun(
    { ...base, expectTools: ["getYarnLiveStock"] },
    {
      answer: "12 yarns. Narrow it.",
      toolCalls: [
        {
          name: "getYarnLiveStock",
          output: { error: "TOO_MANY", count: 12, counts: ["30s"], colours: ["Black"] },
        },
      ],
      error: null,
    }
  );
  if (
    yarnMatchCount.pass ||
    !yarnMatchCount.failures.some((line) => line.includes("number not in tool output"))
  ) {
    throw new Error("TOO_MANY count was treated as a quantity");
  }
  const kePar = gradeRun(
    { ...base, language: "hinglish" },
    { answer: "Order ORD-000123 ke floors par: Checking 22.50 pairs.", toolCalls, error: null }
  );
  if (!kePar.pass) {
    throw new Error(`ke/par was not Hinglish: ${kePar.failures.join("; ")}`);
  }
  const plainEnglish = gradeRun(base, {
    answer: "Checking 22.50 pairs. Send the order number if you want the floor list.",
    toolCalls,
    error: null,
  });
  if (!plainEnglish.pass) {
    throw new Error(
      `English reply without ke/par/pe/ka/ki was rejected: ${plainEnglish.failures.join("; ")}`
    );
  }
  const leakCase = {
    ...base,
    expectTools: [],
    expectRefusal: true,
    failOnOrderData: true,
  };
  const notFoundOnly = gradeRun(leakCase, {
    answer:
      "That order was not found. I can't list all production orders. I can report its status and pending pairs by floor.",
    toolCalls: [
      {
        name: "getProductionOrder",
        input: { orderNumber: "all" },
        output: { error: "NOT_FOUND" },
      },
    ],
    error: null,
  });
  if (!notFoundOnly.pass) {
    throw new Error(`NOT_FOUND tool call was a failure: ${notFoundOnly.failures.join("; ")}`);
  }
  const leaked = gradeRun(leakCase, {
    answer: "ORD-900199 is In Progress with 12 pairs.",
    toolCalls: [
      {
        name: "getProductionOrder",
        output: {
          orderNumber: "ORD-900199",
          derivedStatus: "In Progress",
          orderSummary: { inProduction: 12 },
        },
      },
    ],
    error: null,
  });
  const leakedText = leaked.failures.join("; ");
  if (
    leaked.pass ||
    !leakedText.includes("ORD-900199") ||
    !leakedText.includes("status") ||
    !leakedText.includes("quantity")
  ) {
    throw new Error(`order data leak was not graded: ${leakedText}`);
  }
  assertWarehouseGradeSelfCheck();
  assertOrderSummaryRule();
}
