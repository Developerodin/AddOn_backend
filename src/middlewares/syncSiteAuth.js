import httpStatus from 'http-status';
import config from '../config/config.js';
import ApiError from '../utils/ApiError.js';
import { verifySiteCredential } from '../services/sync/syncCredential.service.js';

/**
 * Site-to-site auth for /v1/sync. Reads X-Sync-Key-Id, X-Sync-Credential, X-Sync-Site only.
 * - Does not read `Authorization`; a user JWT never authorizes these routes.
 * - Does not set `req.user`. Sets `req.syncSite`.
 * - Missing and wrong credentials get the same 401 message.
 * Separate from apiKeyAuth (website order ingest key).
 */
const UNAUTHORIZED_MESSAGE = 'Invalid sync credentials';
const MAX_HEADER_LEN = 256;

const readHeader = (req, name) => {
  const v = req.get(name);
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return t.length > 0 && t.length <= MAX_HEADER_LEN ? t : '';
};

/** 404 for every /v1/sync route while SYNC_ENABLED is false. Evaluated per request. */
export const syncEnabledGate = (req, res, next) => {
  if (!config.sync || !config.sync.enabled) return next(new ApiError(httpStatus.NOT_FOUND, 'Not found'));
  return next();
};

const syncSiteAuth = async (req, res, next) => {
  try {
    const keyId = readHeader(req, 'X-Sync-Key-Id');
    const secret = readHeader(req, 'X-Sync-Credential');
    const siteId = readHeader(req, 'X-Sync-Site');
    if (!keyId || !secret || !siteId) {
      return next(new ApiError(httpStatus.UNAUTHORIZED, UNAUTHORIZED_MESSAGE));
    }
    const site = await verifySiteCredential({ keyId, secret, siteId });
    if (!site) return next(new ApiError(httpStatus.UNAUTHORIZED, UNAUTHORIZED_MESSAGE));
    req.syncSite = site;
    return next();
  } catch (err) {
    return next(err);
  }
};

export default syncSiteAuth;
