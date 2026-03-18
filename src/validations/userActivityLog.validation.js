import Joi from 'joi';
import { objectId } from './custom.validation.js';

const actionValues = ['create', 'read', 'update', 'delete', 'list', 'login', 'logout', 'other'];
const methodValues = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
const sortByValues = ['createdAt', 'method', 'path', 'statusCode', 'durationMs', 'action', 'resource'];

/** Shared query schema for logs - used by me, user, and admin list */
const logsQuerySchema = Joi.object().keys({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  resource: Joi.string(),
  action: Joi.string().valid(...actionValues),
  method: Joi.string().valid(...methodValues),
  statusCode: Joi.number().integer().min(100).max(599),
  errorsOnly: Joi.boolean(), // true = statusCode >= 400 (spicy/error logs)
  pathSearch: Joi.string().max(200), // partial match in path
  dateFrom: Joi.alternatives().try(Joi.date(), Joi.string().isoDate()),
  dateTo: Joi.alternatives().try(Joi.date(), Joi.string().isoDate()),
  sortBy: Joi.string().valid(...sortByValues).default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

const getActivityLogs = {
  query: logsQuerySchema,
};

const getActivityStats = {
  query: Joi.object().keys({
    dateFrom: Joi.alternatives().try(Joi.date(), Joi.string().isoDate()),
    dateTo: Joi.alternatives().try(Joi.date(), Joi.string().isoDate()),
    resource: Joi.string(),
    action: Joi.string().valid(...actionValues),
    method: Joi.string().valid(...methodValues),
  }),
};

const getUserLogs = {
  params: Joi.object().keys({
    userId: Joi.string().required().custom(objectId),
  }),
  query: logsQuerySchema,
};

const getUserStats = {
  params: Joi.object().keys({
    userId: Joi.string().required().custom(objectId),
  }),
  query: Joi.object().keys({
    dateFrom: Joi.alternatives().try(Joi.date(), Joi.string().isoDate()),
    dateTo: Joi.alternatives().try(Joi.date(), Joi.string().isoDate()),
    resource: Joi.string(),
    action: Joi.string().valid(...actionValues),
    method: Joi.string().valid(...methodValues),
  }),
};

/** Admin: list all logs, optional userId filter */
const getAllLogs = {
  query: logsQuerySchema.keys({
    userId: Joi.string().custom(objectId), // filter by user (optional)
  }),
};

export { getActivityLogs, getActivityStats, getUserLogs, getUserStats, getAllLogs };
