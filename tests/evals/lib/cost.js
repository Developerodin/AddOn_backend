/**
 * USD per 1M text tokens.
 * Sources checked 2026-10-19:
 * https://developers.openai.com/api/docs/pricing
 * https://developers.openai.com/api/docs/models/gpt-4.1
 * https://developers.openai.com/api/docs/models/gpt-5.4
 * https://developers.openai.com/api/docs/models/gpt-5.6-luna
 * Luna rates are the short-context bracket (input at or under 272K).
 */
const PRICES = {
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "gpt-4.1": { input: 2, cachedInput: 0.5, output: 8 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5.1": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
};

/**
 * Adds one AI SDK usage object into a running total.
 * @param {{ inputTokens: number, outputTokens: number, totalTokens: number, cachedInputTokens: number }} total
 * @param {object|null|undefined} usage
 * @returns {{ inputTokens: number, outputTokens: number, totalTokens: number, cachedInputTokens: number }}
 */
export function addUsage(total, usage) {
  if (!usage) return total;
  const cached =
    usage.inputTokenDetails && usage.inputTokenDetails.cacheReadTokens;
  return {
    inputTokens: total.inputTokens + (Number(usage.inputTokens) || 0),
    outputTokens: total.outputTokens + (Number(usage.outputTokens) || 0),
    totalTokens: total.totalTokens + (Number(usage.totalTokens) || 0),
    cachedInputTokens: total.cachedInputTokens + (Number(cached) || 0),
  };
}

/**
 * Estimated USD for a summed usage. Null when the model has no price row.
 * Cached input is priced apart from the rest of the input tokens.
 * @param {string} model
 * @param {{ inputTokens: number, outputTokens: number, cachedInputTokens: number }} usage
 * @returns {number|null}
 */
export function estimateCostUsd(model, usage) {
  const price = PRICES[model];
  if (!price || !usage) return null;
  const cached = usage.cachedInputTokens || 0;
  const input = Math.max(0, (usage.inputTokens || 0) - cached);
  const output = usage.outputTokens || 0;
  const usd =
    (input * price.input + cached * price.cachedInput + output * price.output) /
    1e6;
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * USD saved because cache reads were not billed as fresh input.
 * @param {string} model
 * @param {{ cachedInputTokens: number }} usage
 * @returns {number|null}
 */
export function cacheSavingsUsd(model, usage) {
  const price = PRICES[model];
  if (!price || !usage) return null;
  const cached = usage.cachedInputTokens || 0;
  const saved = (cached * (price.input - price.cachedInput)) / 1e6;
  return Math.round(saved * 1e6) / 1e6;
}
