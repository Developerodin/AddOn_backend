import passport from 'passport';
import jwt from 'jsonwebtoken';
import config from '../config/config.js';
import User from '../models/user.model.js';
import { tokenTypes } from '../config/tokens.js';

/**
 * Optional auth - populates req.user from JWT if present, never rejects.
 * Uses passport first; falls back to manual JWT decode if passport fails (e.g. token not in Token model).
 */
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }

  passport.authenticate('jwt', { session: false }, async (err, user) => {
    if (user) {
      req.user = user;
      return next();
    }
    // Fallback: manually decode JWT and fetch user (passport may fail if token not in Token model)
    try {
      const token = authHeader.slice(7);
      const payload = jwt.verify(token, config.jwt.secret);
      if (payload.type !== tokenTypes.ACCESS) return next();
      const dbUser = await User.findById(payload.sub);
      if (dbUser) req.user = dbUser;
    } catch {
      // Invalid/expired token - ignore
    }
    next();
  })(req, res, next);
};

export default optionalAuth;
