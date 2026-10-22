import { expect, test } from "@jest/globals"; // eslint-disable-line import/no-extraneous-dependencies

import { assertGradeSelfCheck } from "./gradeSelfCheck.js";

test("eval grader self-check holds, including the orderSummary rule", () => {
  expect(() => assertGradeSelfCheck()).not.toThrow();
});
