import { getNavigationPermission } from '../utils/navigationHelper.js';

/** @type {Array<AiToolDefinition>} */
const tools = [];

/**
 * @typedef {Object} AiToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {'READ'|'COMPUTE'|'WRITE'} type
 * @property {string} navPath
 * @property {import('zod').ZodType} inputSchema
 * @property {(input: object, ctx: { user: object }) => Promise<object>} run
 */

/**
 * @typedef {Object} AiToolCallRecord
 * @property {string} name
 * @property {object} input
 * @property {object|null} output
 * @property {number} ms
 * @property {string|null} error
 */

/**
 * Registers one tool. A second registration of the same name is ignored.
 * @param {AiToolDefinition} definition
 * @returns {AiToolDefinition}
 */
export function defineTool(definition) {
  const existing = tools.find((tool) => tool.name === definition.name);
  if (existing) return existing;
  tools.push(definition);
  return definition;
}

/**
 * Tools currently registered.
 * @returns {AiToolDefinition[]}
 */
export function listTools() {
  return tools.slice();
}

/**
 * Permission gate, then the tool body. Times the call for the trace.
 * @param {AiToolDefinition} definition
 * @param {object} input
 * @param {{ user: { navigation?: object } }} ctx
 * @param {AiToolCallRecord[]} records
 * @returns {Promise<object>}
 */
async function runDefinedTool(definition, input, ctx, records) {
  const started = Date.now();
  const allowed = getNavigationPermission(ctx?.user?.navigation, definition.navPath);
  if (!allowed) {
    const output = { error: 'NO_PERMISSION', navPath: definition.navPath };
    records.push({
      name: definition.name,
      input,
      output,
      ms: Date.now() - started,
      error: 'NO_PERMISSION',
    });
    return output;
  }

  try {
    const output = await definition.run(input, ctx);
    const error = output && typeof output.error === 'string' ? output.error : null;
    records.push({
      name: definition.name,
      input,
      output,
      ms: Date.now() - started,
      error,
    });
    return output;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    records.push({
      name: definition.name,
      input,
      output: null,
      ms: Date.now() - started,
      error: message,
    });
    throw err;
  }
}

/**
 * Runs one tool after the navigation check. A denied screen never calls `run`.
 * @param {string} name
 * @param {object} input
 * @param {{ user: { navigation?: object } }} ctx
 * @param {AiToolCallRecord[]} [records]
 * @returns {Promise<object>}
 */
export async function executeTool(name, input, ctx, records = []) {
  const definition = tools.find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`Unknown AI tool: ${name}`);
  }
  return runDefinedTool(definition, input, ctx, records);
}

/**
 * AI SDK tool map for one request. Records land in `records`.
 * @param {{ user: { navigation?: object } }} ctx
 * @param {AiToolCallRecord[]} records
 * @returns {Record<string, { description: string, inputSchema: import('zod').ZodType, execute: Function }>}
 */
export function buildToolSet(ctx, records) {
  return tools.reduce(
    (set, definition) => ({
      ...set,
      [definition.name]: {
        description: definition.description,
        inputSchema: definition.inputSchema,
        execute: (input) => runDefinedTool(definition, input, ctx, records),
      },
    }),
    {}
  );
}
