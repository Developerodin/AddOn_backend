import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as ticketValidation from '../../../validations/helpSupport/ticket.validation.js';
import * as ticketController from '../../../controllers/helpSupport/ticket.controller.js';

const router = express.Router();

router
  .route('/')
  .post(auth('getHelpSupportTickets'), validate(ticketValidation.createTicket), ticketController.createTicket)
  .get(auth('getHelpSupportTickets'), validate(ticketValidation.listTickets), ticketController.listTickets);

router
  .route('/:ticketId')
  .get(auth('getHelpSupportTickets'), validate(ticketValidation.ticketIdParam), ticketController.getTicket)
  .patch(
    auth('manageHelpSupportTickets'),
    validate(ticketValidation.updateTicket),
    ticketController.updateTicket
  )
  .delete(
    auth('deleteHelpSupportTickets'),
    validate(ticketValidation.ticketIdParam),
    ticketController.deleteTicket
  );

router.patch(
  '/:ticketId/status',
  auth('manageHelpSupportTickets'),
  validate(ticketValidation.updateStatus),
  ticketController.updateStatus
);

router.patch(
  '/:ticketId/disposition',
  auth('manageHelpSupportTickets'),
  validate(ticketValidation.updateDisposition),
  ticketController.updateDisposition
);

router.patch(
  '/:ticketId/assign',
  auth('manageHelpSupportTickets'),
  validate(ticketValidation.assignTicket),
  ticketController.assignTicket
);

router.get(
  '/:ticketId/history',
  auth('getHelpSupportTickets'),
  validate(ticketValidation.ticketIdParam),
  ticketController.getHistory
);

router
  .route('/:ticketId/comments')
  .post(auth('getHelpSupportTickets'), validate(ticketValidation.addComment), ticketController.addComment)
  .get(auth('getHelpSupportTickets'), validate(ticketValidation.ticketIdParam), ticketController.listComments);

export default router;
