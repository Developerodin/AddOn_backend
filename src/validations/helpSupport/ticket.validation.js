import Joi from 'joi';
import { objectId } from '../custom.validation.js';
import {
  TICKET_STATUS,
  TICKET_DISPOSITION,
  TICKET_CATEGORY,
  TICKET_PRIORITY,
} from '../../models/helpSupport/ticket.model.js';

const attachmentSchema = Joi.object({
  fileName: Joi.string().trim().allow(''),
  url: Joi.string().trim().uri(),
  key: Joi.string().trim().allow(''),
  size: Joi.number().min(0),
  mimeType: Joi.string().trim().allow(''),
});

const analyticsQuery = Joi.object({
  dateFrom: Joi.alternatives().try(Joi.date(), Joi.string().isoDate()),
  dateTo: Joi.alternatives().try(Joi.date(), Joi.string().isoDate()),
  assignedTo: Joi.string().custom(objectId),
  category: Joi.string().valid(...TICKET_CATEGORY),
  priority: Joi.string().valid(...TICKET_PRIORITY),
  raisedBy: Joi.string().custom(objectId),
  bucket: Joi.string().valid('day', 'week'),
});

const createTicket = {
  body: Joi.object({
    title: Joi.string().required().trim().max(200),
    description: Joi.string().trim().allow(''),
    pointsToBeCovered: Joi.array().items(Joi.string().trim()),
    category: Joi.string().valid(...TICKET_CATEGORY),
    priority: Joi.string().valid(...TICKET_PRIORITY),
    attachments: Joi.array().items(attachmentSchema),
    tags: Joi.array().items(Joi.string().trim()),
    slaDueAt: Joi.date(),
  }),
};

const listTickets = {
  query: Joi.object({
    status: Joi.string().valid(...TICKET_STATUS),
    disposition: Joi.string().valid(...TICKET_DISPOSITION),
    priority: Joi.string().valid(...TICKET_PRIORITY),
    category: Joi.string().valid(...TICKET_CATEGORY),
    assignedTo: Joi.string().custom(objectId),
    raisedBy: Joi.string().custom(objectId),
    search: Joi.string().trim().max(200),
    sortBy: Joi.string(),
    limit: Joi.number().integer().min(1).max(100),
    page: Joi.number().integer().min(1),
    dateFrom: Joi.alternatives().try(Joi.date(), Joi.string().isoDate()),
    dateTo: Joi.alternatives().try(Joi.date(), Joi.string().isoDate()),
  }),
};

const ticketIdParam = {
  params: Joi.object({
    ticketId: Joi.string().required(),
  }),
};

const updateTicket = {
  ...ticketIdParam,
  body: Joi.object({
    title: Joi.string().trim().max(200),
    description: Joi.string().trim().allow(''),
    pointsToBeCovered: Joi.array().items(Joi.string().trim()),
    category: Joi.string().valid(...TICKET_CATEGORY),
    priority: Joi.string().valid(...TICKET_PRIORITY),
    tags: Joi.array().items(Joi.string().trim()),
    assignedTo: Joi.string().custom(objectId).allow(null),
    attachments: Joi.array().items(attachmentSchema),
    slaDueAt: Joi.date().allow(null),
  }).min(1),
};

const updateStatus = {
  ...ticketIdParam,
  body: Joi.object({
    status: Joi.string()
      .valid(...TICKET_STATUS)
      .required(),
    note: Joi.string().trim().max(1000),
  }),
};

const updateDisposition = {
  ...ticketIdParam,
  body: Joi.object({
    disposition: Joi.string()
      .valid(...TICKET_DISPOSITION)
      .required(),
    note: Joi.string().trim().max(1000),
  }),
};

const assignTicket = {
  ...ticketIdParam,
  body: Joi.object({
    assignedTo: Joi.string().custom(objectId).required(),
  }),
};

const addComment = {
  ...ticketIdParam,
  body: Joi.object({
    body: Joi.string().required().trim().max(5000),
    isInternal: Joi.boolean(),
    attachments: Joi.array().items(attachmentSchema),
  }),
};

const getAnalytics = { query: analyticsQuery };

export {
  createTicket,
  listTickets,
  ticketIdParam,
  updateTicket,
  updateStatus,
  updateDisposition,
  assignTicket,
  addComment,
  getAnalytics,
};
