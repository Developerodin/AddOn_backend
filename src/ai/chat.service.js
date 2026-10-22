import {
  convertToModelMessages,
  isStepCount,
  pipeUIMessageStreamToResponse,
  streamText,
  toUIMessageStream,
} from "ai";
import { openai } from "@ai-sdk/openai";
import httpStatus from "http-status";
import { languageInstruction } from "./detectLanguage.js";
import latestUserMessage from "./latestUserMessage.js";
import {
  chatModelId,
  chatReasoningEffort,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from "./loadSystemPrompt.js";
import AiTrace from "./models/aiTrace.model.js";
import { buildToolSet } from "./registry.js";
import registerTools from "./tools/registerTools.js";

registerTools();

/** Step cap for one chat request. v7 name is `isStepCount` (was `stepCountIs`). */
const MAX_STEPS = 8;

/**
 * Provider options for this model.
 * An explicit effort overrides `AI_CHAT_REASONING` and the model default.
 * The live default is gpt-5.6-luna at `low`. A non-reasoning model gets none.
 * `reasoningSummary: null` stops the SDK from attaching a detailed reasoning trace.
 * @param {string} model
 * @param {string} [override]
 * @returns {object}
 */
function reasoningOptions(model, override) {
  const configured = typeof override === "string" ? override.trim() : "";
  const reasoningEffort = configured || chatReasoningEffort(model);
  if (!reasoningEffort) return {};
  return {
    providerOptions: {
      openai: { reasoningEffort, reasoningSummary: null },
    },
  };
}

/**
 * Base prompt plus one language line for this turn.
 * @param {object[]} messages
 * @returns {string}
 */
function systemPromptFor(messages) {
  const line = languageInstruction(latestUserMessage(messages));
  return `${SYSTEM_PROMPT.replace(/\s+$/, "")}\n${line}`;
}

/**
 * Persists exactly one trace for this request, including failures.
 * @param {object} doc
 * @returns {Promise<void>}
 */
async function writeTrace(doc) {
  try {
    await AiTrace.create(doc);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ai] AiTrace write failed:", message);
  }
}

/**
 * Opens one chat turn with the production prompt, model, tools, and step cap.
 * HTTP streaming and the eval runner both go through here.
 * Awaited so a mocked Promise and the real stream result both come back as a value.
 * @param {object} args
 * @param {{ id: unknown, navigation?: object }} args.user
 * @param {object[]} args.messages UI messages (`parts`), same shape the assistant page sends
 * @param {string} [args.modelId] Overrides `AI_CHAT_MODEL` for this turn only
 * @param {object[]} args.toolCalls Filled by the tool gate as calls finish
 * @param {Function} [args.onFinish]
 * @param {Function} [args.onError]
 * @param {string} [args.reasoningEffort] Overrides the model default for this turn only
 * @returns {Promise<{ model: string, result: object }>}
 */
export async function openChatStream({
  user,
  messages,
  modelId,
  toolCalls,
  onFinish,
  onError,
  reasoningEffort,
}) {
  const configured = typeof modelId === "string" ? modelId.trim() : "";
  const model = configured || chatModelId();
  const result = await streamText({
    model: openai(model),
    system: systemPromptFor(messages),
    messages: await convertToModelMessages(messages),
    tools: buildToolSet({ user }, toolCalls),
    stopWhen: isStepCount(MAX_STEPS),
    onFinish,
    onError,
    ...reasoningOptions(model, reasoningEffort),
  });
  return { model, result };
}

/**
 * Runs one chat turn to completion and writes the same AiTrace row as HTTP.
 * Used by the eval runner. Does not touch the HTTP response.
 * @param {object} args
 * @param {{ id: unknown, navigation?: object }} args.user
 * @param {object[]} args.messages
 * @param {string} [args.modelId]
 * @param {string} [args.reasoningEffort] Overrides the model default for this turn only
 * @returns {Promise<{ answer: string, toolCalls: object[], tokens: object|null, error: string|null, model: string, latencyMs: number }>}
 */
export async function completeChatTurn({ user, messages, modelId, reasoningEffort }) {
  const toolCalls = [];
  const message = latestUserMessage(messages);
  let answer = "";
  let tokens = null;
  let requestError = null;
  let model =
    typeof modelId === "string" && modelId.trim()
      ? modelId.trim()
      : chatModelId();
  const started = Date.now();

  try {
    if (!Array.isArray(messages) || messages.length === 0) {
      requestError = "messages is required";
    } else {
      const opened = await openChatStream({
        user,
        messages,
        modelId,
        reasoningEffort,
        toolCalls,
        onFinish: (event) => {
          answer = typeof event?.text === "string" ? event.text : "";
          tokens = event?.usage ?? null;
        },
        onError: ({ error }) => {
          requestError = error instanceof Error ? error.message : String(error);
        },
      });
      model = opened.model;
      const text = await opened.result.text;
      if (!answer && typeof text === "string") answer = text;
      if (!tokens && opened.result.usage) tokens = await opened.result.usage;
    }
  } catch (err) {
    requestError = err instanceof Error ? err.message : String(err);
  }

  await writeTrace({
    userId: user.id,
    message,
    model,
    promptVersion: PROMPT_VERSION,
    toolCalls,
    answer,
    tokens,
    error: requestError,
  });

  return {
    answer,
    toolCalls,
    tokens,
    error: requestError,
    model,
    latencyMs: Date.now() - started,
  };
}

/**
 * Streams one chat turn. The HTTP response finishes before the trace insert.
 * A failed insert is logged and does not change the response.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export default async function streamChat(req, res) {
  const toolCalls = [];
  const model = chatModelId();
  const message = latestUserMessage(req.body?.messages);
  let answer = "";
  let tokens = null;
  let requestError = null;

  try {
    if (!Array.isArray(req.body?.messages) || req.body.messages.length === 0) {
      requestError = "messages is required";
      res.status(httpStatus.BAD_REQUEST).json({
        code: httpStatus.BAD_REQUEST,
        message: "messages is required",
      });
    } else {
      const { result } = await openChatStream({
        user: req.user,
        messages: req.body.messages,
        toolCalls,
        onFinish: (event) => {
          answer = typeof event?.text === "string" ? event.text : "";
          tokens = event?.usage ?? null;
        },
        onError: ({ error }) => {
          requestError = error instanceof Error ? error.message : String(error);
        },
      });

      res.setHeader("X-Accel-Buffering", "no");
      await pipeUIMessageStreamToResponse({
        response: res,
        headers: { "X-Accel-Buffering": "no" },
        stream: toUIMessageStream({ stream: result.stream }),
      });
    }
  } catch (err) {
    requestError = err instanceof Error ? err.message : String(err);
    console.error("[ai] chat failed:", requestError);
    if (!res.headersSent) {
      res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
        code: httpStatus.INTERNAL_SERVER_ERROR,
        message: "Chat failed",
      });
    }
  }

  await writeTrace({
    userId: req.user.id,
    message,
    model,
    promptVersion: PROMPT_VERSION,
    toolCalls,
    answer,
    tokens,
    error: requestError,
  });
}
