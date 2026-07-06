import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

export const WhmsInvoiceStatus = Object.freeze({
  DRAFT: 'draft',
  FINAL: 'final',
  CANCELLED: 'cancelled',
});

const invoiceItemSchema = mongoose.Schema(
  {
    styleCode: { type: String, required: true, trim: true },
    skuCode: { type: String, trim: true },
    size: { type: String, trim: true, default: '' },
    shade: { type: String, trim: true, default: '' },
    /** Billed quantity = scanned quantity from the completed scan session. */
    quantity: { type: Number, required: true, min: 0 },
    rate: { type: Number, min: 0 },
    amount: { type: Number, min: 0 },
  },
  { _id: true }
);

const whmsInvoiceSchema = mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, trim: true, unique: true },
    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'WarehouseOrder', required: true },
    orderNumber: { type: String, trim: true },
    addonOrderId: { type: String, trim: true },
    scanSessionId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ScanSession', default: null },

    clientType: { type: String, trim: true },
    clientId: { type: mongoose.SchemaTypes.ObjectId, ref: 'WarehouseClient', default: null },
    clientName: { type: String, trim: true },

    items: { type: [invoiceItemSchema], default: [] },
    totalQuantity: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: Object.values(WhmsInvoiceStatus),
      default: WhmsInvoiceStatus.FINAL,
    },
    remarks: { type: String, trim: true, default: '' },

    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, trim: true, default: '' },
    cancelledAt: { type: Date },
    cancelReason: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

whmsInvoiceSchema.index({ orderId: 1 });
whmsInvoiceSchema.index({ status: 1, createdAt: -1 });

whmsInvoiceSchema.plugin(toJSON);
whmsInvoiceSchema.plugin(paginate);

const WhmsInvoice = mongoose.model('WhmsInvoice', whmsInvoiceSchema, 'whms_invoices');
export default WhmsInvoice;
