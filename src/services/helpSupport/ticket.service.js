import httpStatus from 'http-status';
import mongoose from 'mongoose';
import ApiError from '../../utils/ApiError.js';
import {
  isHelpSupportAdmin,
  isHelpSupportAgent,
  canDeleteHelpSupportTicket,
  canViewTicket,
  isTicketOwner,
} from '../../utils/helpSupportRole.util.js';
import HelpSupportTicket, {
  HelpSupportTicketCounter,
  TICKET_STATUS,
  TICKET_DISPOSITION,
  TRANSITIONS,
  PAUSED_STATUSES,
  TERMINAL_STATUSES,
  REOPEN_WINDOW_DAYS,
} from '../../models/helpSupport/ticket.model.js';

const POPULATE_FIELDS = 'name email role';
const TICKET_POPULATE = [
  { path: 'raisedBy', select: POPULATE_FIELDS },
  { path: 'assignedTo', select: POPULATE_FIELDS },
  { path: 'statusHistory.changedBy', select: POPULATE_FIELDS },
  { path: 'comments.author', select: POPULATE_FIELDS },
];

/**
 * Initialize empty time-in-status map.
 * @returns {Record<string, number>}
 */
const emptyTimeInStatus = () =>
  TICKET_STATUS.reduce((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {});

/**
 * Resolve ticket by Mongo id or ticket number.
 * @param {string} ticketId
 * @returns {Promise<import('mongoose').Document|null>}
 */
const findTicketDocument = async (ticketId) => {
  if (mongoose.Types.ObjectId.isValid(ticketId)) {
    const byId = await HelpSupportTicket.findOne({ _id: ticketId, isDeleted: false });
    if (byId) return byId;
  }
  return HelpSupportTicket.findOne({ ticketNumber: ticketId, isDeleted: false });
};

/**
 * Add live running duration for the open status entry.
 * @param {Record<string, unknown>} ticketObj
 * @returns {Record<string, unknown>}
 */
export const enrichTicketWithLiveTimes = (ticketObj) => {
  const now = Date.now();
  const timeInStatus = { ...emptyTimeInStatus(), ...(ticketObj.timeInStatus || {}) };
  const openEntry = [...(ticketObj.statusHistory || [])].reverse().find((e) => !e.exitedAt);

  if (openEntry?.enteredAt && ticketObj.status) {
    const runningMs = now - new Date(openEntry.enteredAt).getTime();
    timeInStatus[ticketObj.status] = (timeInStatus[ticketObj.status] || 0) + runningMs;
  }

  const totalActiveTimeMs = TICKET_STATUS.filter((s) => !PAUSED_STATUSES.has(s) && !TERMINAL_STATUSES.has(s)).reduce(
    (sum, s) => sum + (timeInStatus[s] || 0),
    0
  );

  const endAt = ticketObj.closedAt || ticketObj.resolvedAt || new Date(now);
  const totalLifetimeMs = new Date(endAt).getTime() - new Date(ticketObj.createdAt).getTime();

  return {
    ...ticketObj,
    timeInStatus,
    totalActiveTimeMs,
    totalLifetimeMs,
    timeToFirstResponseMs: ticketObj.firstResponseAt
      ? new Date(ticketObj.firstResponseAt).getTime() - new Date(ticketObj.createdAt).getTime()
      : null,
    timeToResolutionMs: ticketObj.resolvedAt
      ? new Date(ticketObj.resolvedAt).getTime() - new Date(ticketObj.createdAt).getTime()
      : null,
    currentStatusEnteredAt: openEntry?.enteredAt || null,
  };
};

/**
 * Serialize ticket for API response.
 * @param {import('mongoose').Document} ticket
 * @param {{ hideInternalComments?: boolean }} [options]
 * @returns {Record<string, unknown>}
 */
const serializeTicket = (ticket, options = {}) => {
  const obj = ticket.toJSON ? ticket.toJSON() : ticket;
  if (options.hideInternalComments) {
    obj.comments = (obj.comments || []).filter((c) => !c.isInternal);
  }
  return enrichTicketWithLiveTimes(obj);
};

/**
 * Build list filter from query and user role.
 * @param {Record<string, unknown>} query
 * @param {{ _id: import('mongoose').Types.ObjectId, role: string }} user
 * @returns {Record<string, unknown>}
 */
const buildListFilter = (query, user) => {
  const filter = { isDeleted: false };

  if (!isHelpSupportAgent(user)) {
    filter.raisedBy = user._id;
  } else if (query.raisedBy) {
    filter.raisedBy = query.raisedBy;
  }

  if (query.status) filter.status = query.status;
  if (query.disposition) filter.disposition = query.disposition;
  if (query.priority) filter.priority = query.priority;
  if (query.category) filter.category = query.category;
  if (query.assignedTo) filter.assignedTo = query.assignedTo;

  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) filter.createdAt.$lte = new Date(query.dateTo);
  }

  if (query.search && typeof query.search === 'string' && query.search.trim()) {
    const term = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(term, 'i');
    filter.$or = [{ title: regex }, { description: regex }, { ticketNumber: regex }];
  }

  return filter;
};

/**
 * Create a new support ticket.
 * @param {Record<string, unknown>} body
 * @param {{ _id: import('mongoose').Types.ObjectId }} user
 */
export const createTicket = async (body, user) => {
  const now = new Date();
  const ticketNumber = await HelpSupportTicketCounter.getNextTicketNumber();

  const ticket = await HelpSupportTicket.create({
    ...body,
    ticketNumber,
    raisedBy: user._id,
    status: 'raised',
    disposition: 'unset',
    timeInStatus: emptyTimeInStatus(),
    statusHistory: [
      {
        fromStatus: null,
        toStatus: 'raised',
        changedBy: user._id,
        enteredAt: now,
        exitedAt: null,
        durationMs: null,
      },
    ],
  });

  await ticket.populate(TICKET_POPULATE).execPopulate();
  return serializeTicket(ticket, { hideInternalComments: !isHelpSupportAgent(user) });
};

/**
 * List tickets with pagination.
 * @param {Record<string, unknown>} query
 * @param {{ _id: import('mongoose').Types.ObjectId, role: string }} user
 */
export const queryTickets = async (query, user) => {
  const filter = buildListFilter(query, user);
  const options = {
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy || 'createdAt:desc',
    populate: TICKET_POPULATE,
  };

  const result = await HelpSupportTicket.paginate(filter, options);
  return {
    ...result,
    results: result.results.map((t) =>
      serializeTicket(t, { hideInternalComments: !isHelpSupportAgent(user) })
    ),
  };
};

/**
 * Get ticket by id or ticket number.
 * @param {string} ticketId
 * @param {{ _id: import('mongoose').Types.ObjectId, role: string }} user
 */
export const getTicketById = async (ticketId, user) => {
  const ticket = await findTicketDocument(ticketId);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Ticket not found');
  }
  if (!canViewTicket(user, ticket)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

  await ticket.populate(TICKET_POPULATE).execPopulate();
  return serializeTicket(ticket, { hideInternalComments: !isHelpSupportAgent(user) });
};

/**
 * Update editable ticket fields (agent/admin).
 * @param {string} ticketId
 * @param {Record<string, unknown>} updateBody
 * @param {{ _id: import('mongoose').Types.ObjectId, role: string }} user
 */
export const updateTicketById = async (ticketId, updateBody, user) => {
  if (!isHelpSupportAgent(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only agents can update tickets');
  }

  const ticket = await findTicketDocument(ticketId);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Ticket not found');
  }

  const allowed = ['title', 'description', 'pointsToBeCovered', 'priority', 'category', 'tags', 'assignedTo', 'slaDueAt', 'attachments'];
  allowed.forEach((key) => {
    if (updateBody[key] !== undefined) {
      ticket[key] = updateBody[key];
    }
  });

  await ticket.save();
  await ticket.populate(TICKET_POPULATE).execPopulate();
  return serializeTicket(ticket);
};

/**
 * Soft-delete a ticket (super admin email only).
 * @param {string} ticketId
 * @param {{ role: string, email?: string }} user
 */
export const deleteTicketById = async (ticketId, user) => {
  if (!canDeleteHelpSupportTicket(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only the super admin can delete tickets');
  }

  const ticket = await findTicketDocument(ticketId);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Ticket not found');
  }

  ticket.isDeleted = true;
  await ticket.save();
};

/**
 * Record a status transition with time tracking.
 * @param {import('mongoose').Document} ticket
 * @param {string} toStatus
 * @param {{ _id: import('mongoose').Types.ObjectId }} user
 * @param {string} [note]
 */
export const recordTransition = async (ticket, toStatus, user, note) => {
  const fromStatus = ticket.status;
  if (fromStatus === toStatus) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Ticket is already in this status');
  }

  const allowed = TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Invalid transition from ${fromStatus}. Allowed: ${allowed.join(', ') || 'none'}`);
  }

  if (fromStatus === 'closed' && toStatus === 'reopened') {
    const closedAt = ticket.closedAt ? new Date(ticket.closedAt).getTime() : 0;
    const windowMs = REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (!closedAt || Date.now() - closedAt > windowMs) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Tickets can only be reopened within ${REOPEN_WINDOW_DAYS} days of closing`);
    }
    ticket.resolvedAt = null;
    ticket.closedAt = null;
  }

  const now = new Date();
  const openEntry = ticket.statusHistory.find((e) => !e.exitedAt);
  if (openEntry) {
    openEntry.exitedAt = now;
    openEntry.durationMs = now.getTime() - new Date(openEntry.enteredAt).getTime();
    if (!ticket.timeInStatus) ticket.timeInStatus = emptyTimeInStatus();
    ticket.timeInStatus[fromStatus] = (ticket.timeInStatus[fromStatus] || 0) + openEntry.durationMs;
    ticket.markModified('timeInStatus');
  }

  ticket.statusHistory.push({
    fromStatus,
    toStatus,
    changedBy: user._id,
    note: note || undefined,
    enteredAt: now,
    exitedAt: null,
    durationMs: null,
  });

  ticket.status = toStatus;

  if (toStatus === 'resolved' && !ticket.resolvedAt) {
    ticket.resolvedAt = now;
  }
  if (toStatus === 'closed') {
    ticket.closedAt = now;
    if (!ticket.resolvedAt) ticket.resolvedAt = now;
  }
  if (toStatus === 'cancelled') {
    ticket.closedAt = now;
  }

  await ticket.save();
};

/**
 * Change ticket status.
 * @param {string} ticketId
 * @param {{ status: string, note?: string }} body
 * @param {{ _id: import('mongoose').Types.ObjectId, role: string }} user
 */
export const updateTicketStatus = async (ticketId, body, user) => {
  if (!isHelpSupportAgent(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only agents can change status');
  }

  const ticket = await findTicketDocument(ticketId);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Ticket not found');
  }

  if (!TICKET_STATUS.includes(body.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid status');
  }

  await recordTransition(ticket, body.status, user, body.note);
  await ticket.populate(TICKET_POPULATE).execPopulate();
  return serializeTicket(ticket);
};

/**
 * Update ticket disposition.
 * @param {string} ticketId
 * @param {{ disposition: string, note?: string }} body
 * @param {{ _id: import('mongoose').Types.ObjectId, role: string }} user
 */
export const updateTicketDisposition = async (ticketId, body, user) => {
  if (!isHelpSupportAgent(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only agents can set disposition');
  }

  const ticket = await findTicketDocument(ticketId);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Ticket not found');
  }

  if (!TICKET_DISPOSITION.includes(body.disposition)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid disposition');
  }

  ticket.disposition = body.disposition;
  ticket.dispositionChangedAt = new Date();

  if (body.note) {
    ticket.comments.push({
      author: user._id,
      body: `Disposition changed to ${body.disposition}: ${body.note}`,
      isInternal: true,
    });
  }

  await ticket.save();
  await ticket.populate(TICKET_POPULATE).execPopulate();
  return serializeTicket(ticket);
};

/**
 * Assign ticket to an agent.
 * @param {string} ticketId
 * @param {{ assignedTo: string }} body
 * @param {{ _id: import('mongoose').Types.ObjectId, role: string }} user
 */
export const assignTicket = async (ticketId, body, user) => {
  if (!isHelpSupportAgent(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only agents can assign tickets');
  }

  const ticket = await findTicketDocument(ticketId);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Ticket not found');
  }

  const assigneeId = body.assignedTo;
  if (!isHelpSupportAdmin(user) && assigneeId !== user._id.toString()) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Agents can only assign tickets to themselves');
  }

  ticket.assignedTo = assigneeId;
  await ticket.save();
  await ticket.populate(TICKET_POPULATE).execPopulate();
  return serializeTicket(ticket);
};

/**
 * Get full status history timeline.
 * @param {string} ticketId
 * @param {{ _id: import('mongoose').Types.ObjectId, role: string }} user
 */
export const getTicketHistory = async (ticketId, user) => {
  const ticket = await findTicketDocument(ticketId);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Ticket not found');
  }
  if (!canViewTicket(user, ticket)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

  await ticket.populate([{ path: 'statusHistory.changedBy', select: POPULATE_FIELDS }]).execPopulate();
  const enriched = serializeTicket(ticket);
  return {
    ticketNumber: enriched.ticketNumber,
    status: enriched.status,
    disposition: enriched.disposition,
    dispositionChangedAt: enriched.dispositionChangedAt,
    statusHistory: enriched.statusHistory,
    timeInStatus: enriched.timeInStatus,
    totalActiveTimeMs: enriched.totalActiveTimeMs,
    totalLifetimeMs: enriched.totalLifetimeMs,
  };
};

/**
 * Add a comment to a ticket.
 * @param {string} ticketId
 * @param {{ body: string, isInternal?: boolean, attachments?: unknown[] }} body
 * @param {{ _id: import('mongoose').Types.ObjectId, role: string }} user
 */
export const addComment = async (ticketId, body, user) => {
  const ticket = await findTicketDocument(ticketId);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Ticket not found');
  }
  if (!canViewTicket(user, ticket)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

  const isInternal = Boolean(body.isInternal);
  if (isInternal && !isHelpSupportAgent(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only agents can add internal notes');
  }
  if (isInternal && isTicketOwner(user, ticket) && !isHelpSupportAgent(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Requesters cannot add internal notes');
  }

  ticket.comments.push({
    author: user._id,
    body: body.body,
    attachments: body.attachments || [],
    isInternal,
  });

  if (isHelpSupportAgent(user) && !isInternal && !ticket.firstResponseAt) {
    ticket.firstResponseAt = new Date();
  }

  await ticket.save();
  await ticket.populate(TICKET_POPULATE).execPopulate();
  return serializeTicket(ticket, { hideInternalComments: !isHelpSupportAgent(user) });
};

/**
 * List comments on a ticket.
 * @param {string} ticketId
 * @param {{ _id: import('mongoose').Types.ObjectId, role: string }} user
 */
export const getComments = async (ticketId, user) => {
  const ticket = await findTicketDocument(ticketId);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Ticket not found');
  }
  if (!canViewTicket(user, ticket)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

  await ticket.populate([{ path: 'comments.author', select: POPULATE_FIELDS }]).execPopulate();
  let comments = ticket.comments.map((c) => (c.toJSON ? c.toJSON() : c));
  if (!isHelpSupportAgent(user)) {
    comments = comments.filter((c) => !c.isInternal);
  }
  return { results: comments };
};

/**
 * Returns allowed next statuses for a ticket.
 * @param {string} currentStatus
 * @returns {string[]}
 */
export const getAllowedTransitions = (currentStatus) => TRANSITIONS[currentStatus] || [];
