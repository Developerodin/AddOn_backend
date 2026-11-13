import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { MAX_BATCH_EVENTS } from '../services/sync/syncPolicy.js';

const id = (max) => Joi.string().trim().min(1).max(max);

/** Structural checks only (400). Policy refusals (422) live in services/sync/syncPolicy.js. */
const eventSchema = Joi.object({
  eventId: id(128).required(),
  siteId: id(64).required(),
  originSequence: Joi.number().integer().min(1).required(),
  entityType: id(64).required(),
  aggregateId: id(128).required(),
  aggregateVersion: Joi.number().integer().min(1).required(),
  eventType: id(128).required(),
  schemaVersion: Joi.number().integer().min(1).required(),
  origin: Joi.string().valid('user', 'sync').required(),
  occurredAt: Joi.date().iso().required(),
  payload: Joi.object().unknown(true).required(),
  payloadHash: Joi.string().hex().length(64),
});

export const postEvents = {
  body: Joi.object().keys({
    events: Joi.array().items(eventSchema).min(1).max(MAX_BATCH_EVENTS).required(),
  }),
};

export const getEvents = {
  query: Joi.object().keys({
    after: Joi.number().integer().min(0),
    limit: Joi.number().integer().min(1).max(MAX_BATCH_EVENTS).default(MAX_BATCH_EVENTS),
  }),
};

export const ackEvents = {
  body: Joi.object().keys({
    publisherSiteId: id(64).required(),
    sequences: Joi.array().items(Joi.number().integer().min(1)).min(1).max(MAX_BATCH_EVENTS).unique().required(),
  }),
};

export const getStatus = {};

export const resolveConflict = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    decision: Joi.string().valid('KEEP_LOCAL', 'KEEP_REMOTE', 'MANUAL').required(),
    note: Joi.string().allow('').max(2000).default(''),
  }),
};

export const listConflicts = {
  query: Joi.object().keys({
    limit: Joi.number().integer().min(1).max(200).default(100),
  }),
};

export const listConflictHistory = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
    entityType: Joi.string().trim().max(64).allow(''),
    aggregateId: Joi.string().trim().max(128).allow(''),
  }),
};
