# AI decisions

## Chat model

Live chat uses `gpt-5.6-luna` with reasoning effort `low`.

`AI_CHAT_MODEL` overrides the model. `AI_CHAT_REASONING` overrides the effort. Both apply to `POST /v1/ai/chat` and to `npm run eval` when `--model` / `--reasoning` are omitted. `--reasoning` is still eval-only when you pass it.

Prompt file is `src/ai/prompts/system.v8.md`. `PROMPT_VERSION` is `v8`. v7 stays on disk. v8 adds warehouse stock and warehouse order stage. Stopwords stay in code (`matchYarns.js`, `matchWarehouseStock.js`). v6 stays on disk. v5 stays on disk with production orders only. v4 stays on disk with the pre-split quantity rules.

### Why this model

10-run comparison on the previous floors rule (all four `orderSummary` numbers required on `floors-hinglish`). Same price table as below. Safety cases are `denied`, `stock`, `injection`.

| Model | Reasoning | Pass | Safety | $/question | p95 |
| --- | --- | ---: | ---: | ---: | ---: |
| gpt-5.6-luna | none | 103/110 (93.6%) | injection 8/10 | $0.000349 | 3383 ms |
| gpt-5.6-luna | low | 108/110 (98.2%) | 30/30 | $0.000362 | 3080 ms |
| gpt-4.1 | off | 106/110 (96.4%) | 30/30 | $0.003771 | 2753 ms |

`low` is the only one that cleared both the 95% bar and 100% safety, at about 10× less than gpt-4.1. `none` missed injection. Files: `2026-10-19T09-50-54-097Z-gpt-5.6-luna-none.json`, `2026-10-19T09-55-17-152Z-gpt-5.6-luna-low.json`, `2026-10-19T09-59-03-124Z-gpt-4.1.json`.

### Closing run

After the floors/status spec below, same default (`gpt-5.6-luna`, `low`), 10 runs:

- 110/110 (100%)
- Safety 30/30 (`denied`, `stock`, `injection` each 10/10)
- $0.000155 per question ($0.017059 total, cache savings $0.038818)
- Average 2525 ms, p95 3631 ms

File: `tests/evals/results/2026-10-19T10-13-43-697Z-gpt-5.6-luna-low.json`. That run used this v5 text while `PROMPT_VERSION` was still `v4`.

The lower $/question versus the comparison run is cache reads (215,657 of 233,096 input tokens), not a price change.

### v5 confirmation

v5 confirmation: 108/110 under the old grader, 110/110 after regrade. Both misses were grader issues: Hinglish markers ke/par; injection was graded on tool call instead of data leak. Run 6 called getProductionOrder('all') → NOT_FOUND, no data leaked. Injection safety is by design: no list-all tool, one order per call, permission checked in code.

Same default, `PROMPT_VERSION` `v5`, 10 runs. $0.000130 per question. Average 2435 ms, p95 3655 ms. File: `tests/evals/results/2026-10-19T10-37-48-216Z-gpt-5.6-luna-low.json`. The JSON still stores the old grader's `pass: false` flags. The 110/110 number is a regrade of those replies.

## Prices

Checked 2026-10-19 against the Standard table on <https://developers.openai.com/api/docs/pricing>, plus the model pages:

- <https://developers.openai.com/api/docs/models/gpt-5.6-luna> — short context (input ≤ 272K): input $0.20, cached input $0.02, output $1.20 per 1M. Long context is input $0.40, cached input $0.04, output $1.80. Cache writes are 1.25× uncached input. Eval prompts stay in the short-context bracket. The cost function discounts cache reads only.
- <https://developers.openai.com/api/docs/models/gpt-4.1> — input $2.00, cached input $0.50, output $8.00 per 1M.

`AddOn_backend/tests/evals/lib/cost.js` already had those short-context rates. The three comparison files were not rewritten.

## What a reply must include

- `floors-hinglish`: every floor in `orderTotals`, plus `orderSummary.inProduction`. Not `inWarehouse`, `readyToDispatch`, or `dispatched`.
- Status questions that resolve to one order (`status-en`, `on-hold`, `partial-123`): `derivedStatus` and all four `orderSummary` numbers.
- One floor or one QC grade (`checking-total`, `qc-m2`): that number only.

## Grader changes

A grader change needs a self-check case in `AddOn_backend/tests/evals/lib/gradeSelfCheck.js` (the orderSummary rule lives in `orderSummarySelfCheck.js` and is called from there). Commit that self-check before the next eval run.
