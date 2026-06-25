import catchAsync from '../../utils/catchAsync.js';
import * as ticketService from '../../services/helpSupport/ticket.service.js';
import { getAllowedTransitions } from '../../services/helpSupport/ticket.service.js';

/**
 * Create a support ticket.
 */
const createTicket = catchAsync(async (req, res) => {
  const ticket = await ticketService.createTicket(req.body, req.user);
  res.status(201).send(ticket);
});

/**
 * List tickets with filters and pagination.
 */
const listTickets = catchAsync(async (req, res) => {
  const result = await ticketService.queryTickets(req.query, req.user);
  res.send(result);
});

/**
 * Get a single ticket by id or ticket number.
 */
const getTicket = catchAsync(async (req, res) => {
  const ticket = await ticketService.getTicketById(req.params.ticketId, req.user);
  const allowedNextStatuses = getAllowedTransitions(ticket.status);
  res.send({ ...ticket, allowedNextStatuses });
});

/**
 * Update ticket fields (agent/admin).
 */
const updateTicket = catchAsync(async (req, res) => {
  const ticket = await ticketService.updateTicketById(req.params.ticketId, req.body, req.user);
  res.send(ticket);
});

/**
 * Soft-delete a ticket (admin).
 */
const deleteTicket = catchAsync(async (req, res) => {
  await ticketService.deleteTicketById(req.params.ticketId, req.user);
  res.status(204).send();
});

/**
 * Change ticket status.
 */
const updateStatus = catchAsync(async (req, res) => {
  const ticket = await ticketService.updateTicketStatus(req.params.ticketId, req.body, req.user);
  res.send(ticket);
});

/**
 * Update ticket disposition.
 */
const updateDisposition = catchAsync(async (req, res) => {
  const ticket = await ticketService.updateTicketDisposition(req.params.ticketId, req.body, req.user);
  res.send(ticket);
});

/**
 * Assign ticket to an agent.
 */
const assignTicket = catchAsync(async (req, res) => {
  const ticket = await ticketService.assignTicket(req.params.ticketId, req.body, req.user);
  res.send(ticket);
});

/**
 * Get ticket status history timeline.
 */
const getHistory = catchAsync(async (req, res) => {
  const history = await ticketService.getTicketHistory(req.params.ticketId, req.user);
  res.send(history);
});

/**
 * Add a comment to a ticket.
 */
const addComment = catchAsync(async (req, res) => {
  const ticket = await ticketService.addComment(req.params.ticketId, req.body, req.user);
  res.status(201).send(ticket);
});

/**
 * List comments on a ticket.
 */
const listComments = catchAsync(async (req, res) => {
  const comments = await ticketService.getComments(req.params.ticketId, req.user);
  res.send(comments);
});

export {
  createTicket,
  listTickets,
  getTicket,
  updateTicket,
  deleteTicket,
  updateStatus,
  updateDisposition,
  assignTicket,
  getHistory,
  addComment,
  listComments,
};
