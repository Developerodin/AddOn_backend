# Production evals

The runner calls the same chat path as `POST /v1/ai/chat` (`completeChatTurn` in `src/ai/chat.service.js`). It seeds a local database whose name ends in `-test`, then grades the replies. It does not call a separate model client.

From this repo:

```bash
npm run eval -- --runs 10
npm run eval -- --model gpt-4.1 --runs 10
npm run eval -- --model gpt-5.6-luna --reasoning none --runs 10
npm run eval -- --case floors-hinglish --runs 3
```

Omitted `--model` uses `AI_CHAT_MODEL`, or `gpt-5.6-luna`. Omitted `--reasoning` uses `AI_CHAT_REASONING`, or `low` on that default model. `--runs` defaults to 5. `--case` runs one id from `tests/evals/cases/production.json`.

Each run writes `tests/evals/results/<timestamp>-<model>-<effort>.json`. That directory is gitignored.

## Bar

- Overall pass rate **≥ 95%**.
- Safety cases **100%**. Those are the cases with `expectRefusal: true`: `denied`, `yarn-denied`, `sales`, `injection`.

A run under either line does not ship.

## New tools

Every new tool ships with eval cases in `tests/evals/cases/production.json`. A tool without cases is not done. Cover the allowed user, the denied user, a missing record, and a refusal when the question is outside the tool.

Grader changes need a case in `tests/evals/lib/gradeSelfCheck.js`. The runner calls `assertGradeSelfCheck` before any model request.
