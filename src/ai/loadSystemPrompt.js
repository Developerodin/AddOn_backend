import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const promptDir = dirname(fileURLToPath(import.meta.url));

/** Prompt file shipped with this phase. v1 through v7 stay on disk. Read at process start. */
export const PROMPT_VERSION = 'v8';

export const SYSTEM_PROMPT = readFileSync(join(promptDir, 'prompts/system.v8.md'), 'utf8');

/** Efforts the API accepts. `max` is a luna alias we do not send. */
export const REASONING_EFFORTS = Object.freeze([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

/** Live chat model when `AI_CHAT_MODEL` is unset. */
export const DEFAULT_CHAT_MODEL = 'gpt-5.6-luna';

/** Live chat reasoning for {@link DEFAULT_CHAT_MODEL} when `AI_CHAT_REASONING` is unset. */
export const DEFAULT_CHAT_REASONING = 'low';

/**
 * Lowest reasoning effort for an OpenAI reasoning model.
 * gpt-5.0 accepts `minimal` and rejects `none`. gpt-5.1 and later accept `none`.
 * Chat snapshots are not reasoning models. Every other model returns null.
 * @param {string} model
 * @returns {'none'|'minimal'|null}
 */
export function reasoningEffortFor(model) {
  const id = String(model || '').trim();
  if (!id || /chat/i.test(id)) return null;
  const gpt = /^gpt-(\d+)(?:\.(\d+))?(?:-|$)/i.exec(id);
  if (gpt) {
    const major = Number(gpt[1]);
    if (major < 5) return null;
    const minor = gpt[2] == null ? 0 : Number(gpt[2]);
    if (major > 5 || minor >= 1) return 'none';
    return 'minimal';
  }
  if (/^o\d/i.test(id)) return 'minimal';
  return null;
}

/**
 * Chat model id. `AI_CHAT_MODEL` overrides the default.
 * @returns {string}
 */
export function chatModelId() {
  const configured = process.env.AI_CHAT_MODEL;
  if (configured && configured.trim()) return configured.trim();
  return DEFAULT_CHAT_MODEL;
}

/**
 * Reasoning effort for the live chat path.
 * `AI_CHAT_REASONING` overrides. The default model uses `low`.
 * Any other model uses the lowest effort that model accepts.
 * @param {string} [model]
 * @returns {string|null}
 */
export function chatReasoningEffort(model) {
  const configured = process.env.AI_CHAT_REASONING;
  if (configured && configured.trim()) {
    const effort = configured.trim();
    if (!REASONING_EFFORTS.includes(effort)) {
      throw new Error(`AI_CHAT_REASONING must be one of ${REASONING_EFFORTS.join(', ')}`);
    }
    return effort;
  }
  const id = String(model || chatModelId()).trim();
  if (id === DEFAULT_CHAT_MODEL) return DEFAULT_CHAT_REASONING;
  return reasoningEffortFor(id);
}
