import { gradeRun } from "./gradeRun.js";

/**
 * A denied reply may repeat a count from the question. Tool kg stays a leak.
 * @returns {void}
 */
export function assertRefusalQuestionLabels() {
  const deniedQuestion = "What is the live stock of 110/70-Navy-Navy-Rubber/Rubber?";
  const deniedCall = {
    name: "getYarnLiveStock",
    output: {
      error: "NO_PERMISSION",
      navPath: "Yarn Management.Dashboard",
      availableKg: 4.5,
    },
  };
  const deniedBase = {
    language: "en",
    expectTools: ["getYarnLiveStock"],
    mustContain: [],
    mustNotContain: [],
    expectRefusal: true,
    question: deniedQuestion,
  };
  const deniedLabel = gradeRun(deniedBase, {
    answer: "You cannot open Yarn Management. No stock for 110/70.",
    toolCalls: [deniedCall],
    error: null,
  });
  if (!deniedLabel.pass) {
    throw new Error(`question label 110/70 was rejected: ${deniedLabel.failures.join("; ")}`);
  }
  const deniedStock = gradeRun(deniedBase, {
    answer: "You cannot open Yarn Management. 4.5 kg.",
    toolCalls: [deniedCall],
    error: null,
  });
  if (
    deniedStock.pass ||
    !deniedStock.failures.some((line) => line.includes("refusal contained numbers"))
  ) {
    throw new Error("denied reply containing 4.5 was allowed");
  }
}
