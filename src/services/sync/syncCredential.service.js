import crypto from 'crypto';
import SyncCredential from '../../models/sync/syncCredential.model.js';
import { sha256Hex } from './syncHash.js';

/**
 * Site credentials for /v1/sync. Secrets are random 32-byte values, so a SHA-256 digest is a sufficient
 * at-rest hash; comparison is constant-time.
 */

/** @param {string} secret */
export const hashSecret = (secret) => sha256Hex(String(secret));

/**
 * @param {string} a hex
 * @param {string} b hex
 */
const safeEqualHex = (a, b) => {
  const ba = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

/** Constant-time fallback compare when no credential row exists, so timing does not reveal key ids. */
const DUMMY_HASH = hashSecret('sync-dummy-secret');

/**
 * @param {{ keyId: string, secret: string, siteId: string }} input
 * @returns {Promise<{ keyId: string, siteId: string } | null>}
 */
export const verifySiteCredential = async ({ keyId, secret, siteId }) => {
  const row = await SyncCredential.findOne({ keyId: String(keyId) }).lean();
  const presented = hashSecret(secret);
  const ok = safeEqualHex(presented, row ? row.secretHash : DUMMY_HASH);
  if (!row || !ok || row.revoked || row.siteId !== siteId) return null;
  SyncCredential.updateOne({ _id: row._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
  return { keyId: row.keyId, siteId: row.siteId };
};

/**
 * Create a credential. Returns the plaintext secret once; only its hash is stored.
 * @param {{ siteId: string, label?: string }} input
 */
export const createSiteCredential = async ({ siteId, label = '' }) => {
  if (!siteId || !String(siteId).trim()) throw new Error('siteId is required');
  const keyId = `sk_${crypto.randomBytes(9).toString('hex')}`;
  const secret = crypto.randomBytes(32).toString('base64url');
  await SyncCredential.create({ keyId, secretHash: hashSecret(secret), siteId: String(siteId).trim(), label });
  return { keyId, secret, siteId: String(siteId).trim() };
};

/** @param {string} keyId */
export const revokeSiteCredential = async (keyId) =>
  SyncCredential.updateOne({ keyId }, { $set: { revoked: true } });
