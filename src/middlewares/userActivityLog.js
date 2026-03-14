import UserActivityLog from '../models/userActivityLog.model.js';

/** Paths to skip logging (health, docs, static) */
const SKIP_PATHS = ['/health', '/docs', '/favicon', '/v1/auth/login', '/v1/auth/register'];

/** Fields to never store from request body */
const SANITIZE_KEYS = ['password', 'token', 'refreshToken', 'secret', 'apiKey'];

/**
 * Sanitize object - remove sensitive fields, limit size
 */
function sanitize(obj, maxDepth = 2, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth >= maxDepth) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SANITIZE_KEYS.some((s) => k.toLowerCase().includes(s))) continue;
    if (typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)) {
      out[k] = sanitize(v, maxDepth, depth + 1);
    } else {
      out[k] = Array.isArray(v) ? `[${v.length} items]` : v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * User activity logging middleware.
 * Attaches to res.finish - logs API call when user is authenticated.
 * Must run early so it can attach the finish handler; logs only when req.user exists at response time.
 */
const userActivityLog = (req, res, next) => {
  const startAt = Date.now();

  res.on('finish', async () => {
    try {
      if (!req.user?._id) {
        if (process.env.NODE_ENV === 'development' && req.method !== 'OPTIONS') {
          console.debug('[userActivityLog] Skip (no req.user):', req.method, req.originalUrl?.split('?')[0]);
        }
        return;
      }
      const path = req.originalUrl?.split('?')[0] || req.path;
      if (SKIP_PATHS.some((p) => path.startsWith(p))) return;

      const statusCode = res.statusCode;
      const method = req.method;

      await UserActivityLog.create({
        userId: req.user._id,
        method,
        path,
        route: path.replace(/\/[^/]+$/, '') || path,
        statusCode,
        action: UserActivityLog.inferAction(method, path),
        resource: UserActivityLog.extractResource(path),
        resourceId: UserActivityLog.extractResourceId(path),
        durationMs: Date.now() - startAt,
        ip: req.ip || req.connection?.remoteAddress,
        userAgent: req.get('user-agent'),
        requestMeta: method !== 'GET' ? sanitize(req.body) : undefined,
        errorMessage: statusCode >= 400 ? res.statusMessage || 'Error' : undefined,
      });
    } catch (err) {
      console.error('[userActivityLog] Failed to log:', err.message);
    }
  });

  next();
};

export default userActivityLog;
