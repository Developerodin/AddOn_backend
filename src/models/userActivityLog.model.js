import mongoose from 'mongoose';
import toJSON from './plugins/toJSON.plugin.js';
import paginate from './plugins/paginate.plugin.js';

/**
 * User Activity Log - Tracks all API calls and system usage per user
 * Stores: endpoint, method, status, timestamps, resource actions (create/update/delete/get)
 */
const userActivityLogSchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** HTTP method: GET, POST, PATCH, PUT, DELETE */
    method: {
      type: String,
      required: true,
      enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    },
    /** Full request path e.g. /v1/products/123 */
    path: {
      type: String,
      required: true,
      index: true,
    },
    /** Base path/route e.g. /v1/products */
    route: {
      type: String,
      index: true,
    },
    /** HTTP status code of response */
    statusCode: {
      type: Number,
      required: true,
      index: true,
    },
    /** Action type inferred from method: create, read, update, delete, list */
    action: {
      type: String,
      enum: ['create', 'read', 'update', 'delete', 'list', 'login', 'logout', 'other'],
      default: 'other',
      index: true,
    },
    /** Resource/module e.g. products, orders, yarn-purchase-orders */
    resource: {
      type: String,
      index: true,
    },
    /** Request duration in ms */
    durationMs: {
      type: Number,
    },
    /** Client IP */
    ip: {
      type: String,
    },
    /** User-Agent header */
    userAgent: {
      type: String,
    },
    /** Optional: resource ID from path params (e.g. productId, orderId) */
    resourceId: {
      type: String,
    },
    /** Optional: request body summary (sanitized, no passwords) */
    requestMeta: {
      type: mongoose.Schema.Types.Mixed,
    },
    /** Optional: error message if status >= 400 */
    errorMessage: {
      type: String,
    },
  },
  { timestamps: true }
);

// Compound index for user + time range queries
userActivityLogSchema.index({ userId: 1, createdAt: -1 });
userActivityLogSchema.index({ userId: 1, resource: 1, createdAt: -1 });
userActivityLogSchema.index({ createdAt: -1 }); // for cleanup/retention

userActivityLogSchema.plugin(toJSON);
userActivityLogSchema.plugin(paginate);

/**
 * Infer action from HTTP method and path
 */
userActivityLogSchema.statics.inferAction = function (method, path) {
  if (path.includes('/login')) return 'login';
  if (path.includes('/logout')) return 'logout';
  switch (method) {
    case 'POST':
      return 'create';
    case 'GET':
      return path.match(/\/[^/]+\/[^/]+$/) && !path.includes('/search') ? 'read' : 'list';
    case 'PATCH':
    case 'PUT':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return 'other';
  }
};

/**
 * Extract resource name from path e.g. /v1/products -> products
 */
userActivityLogSchema.statics.extractResource = function (path) {
  const parts = path.split('/').filter(Boolean);
  return parts[1] || 'unknown'; // /v1/products -> products
};

/**
 * Extract resource ID from path if present
 */
userActivityLogSchema.statics.extractResourceId = function (path) {
  const parts = path.split('/').filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 1] : null;
};

const UserActivityLog = mongoose.model('UserActivityLog', userActivityLogSchema);

export default UserActivityLog;
