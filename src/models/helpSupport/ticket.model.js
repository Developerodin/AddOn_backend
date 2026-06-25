import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

/** @type {readonly string[]} */
export const TICKET_STATUS = [
  'raised',
  'pending',
  'in_progress',
  'in_review',
  'on_hold',
  'awaiting_user',
  'resolved',
  'reopened',
  'closed',
  'cancelled',
];

/** @type {readonly string[]} */
export const TICKET_DISPOSITION = [
  'unset',
  'user_set_path',
  'completed',
  'pending_discussion',
  'needs_more_info',
  'duplicate',
  'not_reproducible',
  'wont_fix',
  'deferred',
  'escalated',
];

/** @type {readonly string[]} */
export const TICKET_CATEGORY = ['bug', 'feature_request', 'how_to', 'data_issue', 'access', 'other'];

/** @type {readonly string[]} */
export const TICKET_PRIORITY = ['low', 'medium', 'high', 'urgent'];

/** Statuses that do not count toward active SLA time. */
export const PAUSED_STATUSES = new Set(['on_hold', 'awaiting_user']);

/** Terminal statuses. */
export const TERMINAL_STATUSES = new Set(['closed', 'cancelled']);

/** Allowed status transitions. */
export const TRANSITIONS = {
  raised: ['pending', 'in_progress', 'cancelled'],
  pending: ['in_progress', 'on_hold', 'awaiting_user', 'cancelled'],
  in_progress: ['in_review', 'on_hold', 'awaiting_user', 'resolved', 'cancelled'],
  in_review: ['in_progress', 'resolved'],
  on_hold: ['in_progress', 'pending', 'cancelled'],
  awaiting_user: ['in_progress', 'pending', 'cancelled'],
  resolved: ['closed', 'reopened'],
  reopened: ['in_progress', 'on_hold'],
  closed: ['reopened'],
  cancelled: [],
};

/** Days after close during which a ticket may be reopened. */
export const REOPEN_WINDOW_DAYS = 7;

const attachmentSchema = new mongoose.Schema(
  {
    fileName: { type: String, trim: true },
    url: { type: String, trim: true },
    key: { type: String, trim: true },
    size: { type: Number },
    mimeType: { type: String, trim: true },
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    fromStatus: { type: String, enum: [...TICKET_STATUS, null], default: null },
    toStatus: { type: String, enum: TICKET_STATUS, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, trim: true },
    enteredAt: { type: Date, required: true },
    exitedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
  },
  { _id: true }
);

const commentSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true },
    attachments: { type: [attachmentSchema], default: [] },
    isInternal: { type: Boolean, default: false },
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } }
);

const ticketSchema = new mongoose.Schema(
  {
    ticketNumber: { type: String, unique: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true },
    pointsToBeCovered: [{ type: String, trim: true }],
    category: { type: String, enum: TICKET_CATEGORY, default: 'other' },
    priority: { type: String, enum: TICKET_PRIORITY, default: 'medium', index: true },
    status: { type: String, enum: TICKET_STATUS, default: 'raised', index: true },
    disposition: { type: String, enum: TICKET_DISPOSITION, default: 'unset', index: true },
    dispositionChangedAt: { type: Date, default: null },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    attachments: { type: [attachmentSchema], default: [] },
    tags: [{ type: String, trim: true }],
    statusHistory: { type: [statusHistorySchema], default: [] },
    comments: { type: [commentSchema], default: [] },
    timeInStatus: { type: mongoose.Schema.Types.Mixed, default: {} },
    firstResponseAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    slaDueAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, collection: 'help_support_tickets' }
);

ticketSchema.plugin(toJSON);
ticketSchema.plugin(paginate);

ticketSchema.index({ createdAt: -1 });
ticketSchema.index({ title: 'text', description: 'text', ticketNumber: 'text' });

/**
 * Atomic counter for ticket numbers (HS-{YYYY}-{seq}).
 */
const ticketCounterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    year: { type: Number, required: true },
    seq: { type: Number, required: true, default: 0, min: 0 },
  },
  { collection: 'help_support_ticket_counters' }
);

ticketCounterSchema.index({ key: 1, year: 1 }, { unique: true });

/**
 * Returns the next human-readable ticket number, e.g. HS-2026-000123.
 * @returns {Promise<string>}
 */
ticketCounterSchema.statics.getNextTicketNumber = async function getNextTicketNumber() {
  const year = new Date().getFullYear();
  const doc = await this.findOneAndUpdate(
    { key: 'help_support', year },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return `HS-${year}-${String(doc.seq).padStart(6, '0')}`;
};

const HelpSupportTicket = mongoose.model('HelpSupportTicket', ticketSchema);
const HelpSupportTicketCounter = mongoose.model('HelpSupportTicketCounter', ticketCounterSchema);

export { HelpSupportTicketCounter };
export default HelpSupportTicket;
