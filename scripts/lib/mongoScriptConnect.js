/**
 * Mongo connection helpers for standalone scripts (mongoose 5.x + mongodb driver 3.x).
 * Handles Node 25+ url.parse issues, Atlas SRV expansion, and legacy query params.
 */
import '../../src/scripts/lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import dns from 'dns/promises';
import { parseMongoRetryWrites, setRetryWritesOnUri } from '../../src/config/mongoUri.js';

/**
 * @param {string} rawUrl
 * @returns {string}
 */
export function sanitizeMongoUrl(rawUrl) {
  let u = String(rawUrl || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  if (u.endsWith('>')) u = u.slice(0, -1);
  return u;
}

/**
 * @param {string} uri
 * @returns {string}
 */
export function redactMongoUri(uri) {
  return uri.replace(/^(mongodb(?:\+srv)?:\/\/)([^@]+)@/i, '$1***:***@');
}

/**
 * URL-encode password when URI contains multiple `@` characters.
 * @param {string} uri
 * @returns {string}
 */
export function normalizeMongoUri(uri) {
  const atCount = (uri.match(/@/g) || []).length;
  if (atCount <= 1) return uri;
  const m = uri.match(/^(mongodb(?:\+srv)?:\/\/)(.*)$/i);
  if (!m) return uri;
  const scheme = m[1];
  const rest = m[2];
  const lastAt = rest.lastIndexOf('@');
  if (lastAt === -1) return uri;
  const creds = rest.slice(0, lastAt);
  const hostAndQuery = rest.slice(lastAt + 1);
  const colonIdx = creds.indexOf(':');
  if (colonIdx === -1) return uri;
  const username = creds.slice(0, colonIdx);
  const password = creds.slice(colonIdx + 1);
  return `${scheme}${username}:${encodeURIComponent(password)}@${hostAndQuery}`;
}

/**
 * Strip query params unsupported by mongodb driver v3.x (e.g. `appName`).
 * @param {string} uri
 * @returns {string}
 */
export function stripUnsupportedMongoParams(uri) {
  const qIdx = uri.indexOf('?');
  if (qIdx === -1) return uri;
  const base = uri.slice(0, qIdx);
  const params = uri.slice(qIdx + 1).split('&').filter(Boolean);
  const kept = params.filter((kv) => {
    const key = (kv.split('=', 1)[0] || '').trim();
    return key && key !== 'appName';
  });
  return kept.length ? `${base}?${kept.join('&')}` : base;
}

/**
 * Expand `mongodb+srv://` into a `mongodb://` host list for legacy driver compatibility.
 * @param {string} uri
 * @returns {Promise<string>}
 */
export async function expandSrvUriIfNeeded(uri) {
  const m = uri.match(/^mongodb\+srv:\/\/([^:]+):([^@]+)@([^/]+)\/([^?]+)(\?.*)?$/i);
  if (!m) return uri;
  const [, username, password, host, dbName, rawQuery] = m;
  const query = (rawQuery || '').replace(/^\?/, '');

  const srv = await dns.resolveSrv(`_mongodb._tcp.${host}`);
  const hosts = srv.map((r) => `${r.name}:${r.port}`).join(',');

  const txt = (await dns.resolveTxt(host)).flat().filter(Boolean).join('&');
  const merged = [txt, query].filter(Boolean).join('&');
  const params = merged ? `${merged}&ssl=true` : 'ssl=true';

  return `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${hosts}/${dbName}?${params}`;
}

/**
 * Builds a driver-safe Mongo URI from config (SRV expanded, params stripped).
 * @param {string} mongoUrl
 * @returns {Promise<string>}
 */
export async function resolveMongoUriForScript(mongoUrl) {
  const cleaned = sanitizeMongoUrl(mongoUrl).replace(/\n/g, '');
  if (!cleaned) {
    throw new Error('Missing MONGODB_URL — set it in AddOn_backend/.env');
  }
  const expanded = (await expandSrvUriIfNeeded(
    stripUnsupportedMongoParams(normalizeMongoUri(cleaned))
  )).replace(/\s/g, '');
  const safeUri = setRetryWritesOnUri(expanded, parseMongoRetryWrites(process.env.MONGODB_RETRY_WRITES));
  if (!/^mongodb:\/\//i.test(safeUri)) {
    throw new Error('Resolved Mongo URI is invalid after normalization');
  }
  return safeUri;
}

/**
 * Connect mongoose for a one-off script using the same workarounds as inspect-order-article.
 * @param {{ mongoose?: { url?: string, options?: object } }} config
 * @returns {Promise<string>} redacted URI used (for logging)
 */
export async function connectMongooseForScript(config) {
  const mongoUrl = config?.mongoose?.url;
  if (typeof mongoUrl !== 'string' || mongoUrl.length === 0) {
    throw new Error('Missing config.mongoose.url (check MONGODB_URL in .env).');
  }
  const safeUri = await resolveMongoUriForScript(mongoUrl);
  const retryWrites = parseMongoRetryWrites(process.env.MONGODB_RETRY_WRITES);
  await mongoose.connect(safeUri, {
    ...(config.mongoose.options || {}),
    retryWrites,
  });
  return redactMongoUri(safeUri);
}
