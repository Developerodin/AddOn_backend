import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import config from '../config/config.js';

/**
 * Authenticate machine-to-machine requests using a shared API key header.
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 */
const apiKeyAuth = (req, _res, next) => {
  const configuredKey = config.integrations?.websiteOrderSyncApiKey;
  if (!configuredKey) {
    return next(new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Website order sync is not configured'));
  }

  const key = req.header('X-API-Key');
  if (!key || key !== configuredKey) {
    return next(new ApiError(httpStatus.UNAUTHORIZED, 'Invalid API key'));
  }

  const allowedIps = config.integrations?.allowedIps || [];
  if (allowedIps.length > 0) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    if (!allowedIps.includes(ip)) {
      return next(new ApiError(httpStatus.FORBIDDEN, 'IP not allowed'));
    }
  }

  next();
};

export default apiKeyAuth;
