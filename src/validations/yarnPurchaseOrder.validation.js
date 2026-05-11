import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { yarnPurchaseOrderStatuses, lotStatuses } from '../models/yarnReq/yarnPurchaseOrder.model.js';

const statusCodeField = Joi.string().valid(...yarnPurchaseOrderStatuses);
const lotStatusField = Joi.string().valid(...lotStatuses);

/** Coerces JSON `null` (from client NaN) and missing values to a non‑negative number. */
const nonNegativeNumberCoerced = Joi.any()
  .custom((value, helpers) => {
    if (value === null || value === undefined) {
      return 0;
    }
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) {
      return helpers.error('any.invalid');
    }
    return n;
  })
  .required();

/** Line items as sent from API; yarn id may be missing for draft POs. */
const poItemSchema = Joi.object()
  .keys({
    _id: Joi.string().custom(objectId).optional(),
    id: Joi.string().custom(objectId).optional(),
    yarnName: Joi.string().trim().allow('', null),
    yarnCatalogId: Joi.string()
      .allow(null, '')
      .custom((value, helpers) => {
        if (value === null || value === undefined || value === '') return value;
        return objectId(value, helpers);
      }),
    yarn: Joi.string()
      .allow(null, '')
      .custom((value, helpers) => {
        if (value === null || value === undefined || value === '') return value;
        return objectId(value, helpers);
      }),
    sizeCount: Joi.string().trim().allow('', null),
    shadeCode: Joi.string().trim().allow('', null),
    rate: Joi.number().min(0).default(0),
    quantity: Joi.number().min(0).default(0),
    estimatedDeliveryDate: Joi.any()
      .custom((value, helpers) => {
        if (value === null || value === undefined || value === '') {
          return null;
        }
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) {
          return helpers.error('any.invalid');
        }
        return value;
      })
      .allow(null),
    gstRate: Joi.number().min(0).allow(null),
    sourceRequisitionId: Joi.string()
      .allow(null, '')
      .custom((value, helpers) => {
        if (value === null || value === undefined || value === '') return value;
        return objectId(value, helpers);
      }),
  })
  .custom((value, helpers) => {
    const id = value.yarnCatalogId || value.yarn;
    if (!id || id === '') {
      return { ...value, yarnCatalogId: undefined, yarn: undefined };
    }
    return { ...value, yarnCatalogId: id };
  });

export const getPurchaseOrders = {
  query: Joi.object()
    .keys({
      start_date: Joi.date().iso().required(),
      end_date: Joi.date().iso().required(),
      status_code: statusCodeField.optional(),
    })
    .with('start_date', 'end_date')
    .with('end_date', 'start_date')
    .custom((value, helpers) => {
      const { start_date: startDate, end_date: endDate } = value;
      if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'start and end date validation'),
};

/** GET supplier tearweight by PO number and yarn name */
export const getSupplierTearweightByPoAndYarnName = {
  query: Joi.object().keys({
    poNumber: Joi.string().trim().required(),
    yarnName: Joi.string().trim().required(),
  }),
};

export const createPurchaseOrder = {
  body: Joi.object()
    .keys({
      poNumber: Joi.string().trim().allow('', null).optional(),
      supplierName: Joi.string().trim().allow('', null),
      supplier: Joi.string()
        .allow(null, '')
        .custom((value, helpers) => {
          if (value === null || value === undefined || value === '') return value;
          return objectId(value, helpers);
        }),
      poItems: Joi.array().items(poItemSchema).default([]),
      notes: Joi.string().trim().allow('', null),
      subTotal: nonNegativeNumberCoerced,
      gst: nonNegativeNumberCoerced,
      total: nonNegativeNumberCoerced,
      currentStatus: statusCodeField.default('submitted_to_supplier'),
      creditDays: Joi.number().min(0).allow(null),
      estimatedOrderDeliveryDate: Joi.any()
        .custom((value, helpers) => {
          if (value === null || value === undefined || value === '') {
            return null;
          }
          const d = new Date(value);
          if (Number.isNaN(d.getTime())) {
            return helpers.error('any.invalid');
          }
          return value;
        })
        .allow(null),
      statusLogs: Joi.array()
        .items(
          Joi.object().keys({
            statusCode: statusCodeField.required(),
            updatedBy: Joi.object()
              .keys({
                username: Joi.string().trim().required(),
                user: Joi.string().custom(objectId).required(),
              })
              .required(),
            updatedAt: Joi.date().iso(),
            notes: Joi.string().trim().allow('', null),
          })
        )
        .default([]),
      goodsReceivedDate: Joi.forbidden(),
      packListDetails: Joi.forbidden(),
      receivedLotDetails: Joi.forbidden(),
      receivedBy: Joi.forbidden(),
    })
    .required()
    .custom((value, helpers) => {
      if (value.currentStatus === 'draft') {
        return value;
      }
      if (!value.supplier || value.supplier === '') {
        return helpers.error('any.custom', { message: 'Supplier is required' });
      }
      if (!value.supplierName || !String(value.supplierName).trim()) {
        return helpers.error('any.custom', { message: 'Supplier name is required' });
      }
      if (!value.poItems?.length) {
        return helpers.error('any.custom', { message: 'At least one PO item is required' });
      }
      for (const item of value.poItems) {
        const cid = item.yarnCatalogId || item.yarn;
        if (!cid) {
          return helpers.error('any.custom', { message: 'Each PO line needs yarnCatalogId (or legacy yarn)' });
        }
      }
      return value;
    }),
};

/** Optional coerced totals for PATCH (matches POST when JSON had null from NaN). */
const optionalNonNegativeNumber = Joi.any()
  .custom((value, helpers) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return 0;
    }
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) {
      return helpers.error('any.invalid');
    }
    return n;
  });

export const getPurchaseOrderById = {
  params: Joi.object().keys({
    purchaseOrderId: Joi.string().custom(objectId).required(),
  }),
};

export const getPurchaseOrderByPoNumber = {
  params: Joi.object().keys({
    poNumber: Joi.string().trim().required(),
  }),
};

export const deletePurchaseOrder = {
  params: Joi.object().keys({
    purchaseOrderId: Joi.string().custom(objectId).required(),
  }),
};

export const updatePurchaseOrder = {
  params: Joi.object().keys({
    purchaseOrderId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      poNumber: Joi.string().trim(),
      supplierName: Joi.string().trim(),
      supplier: Joi.string()
        .allow(null, '')
        .custom((value, helpers) => {
          if (value === null || value === undefined || value === '') return value;
          return objectId(value, helpers);
        }),
      poItems: Joi.array().items(poItemSchema).min(0),
      notes: Joi.string().trim().allow('', null),
      subTotal: optionalNonNegativeNumber,
      gst: optionalNonNegativeNumber,
      total: optionalNonNegativeNumber,
      currentStatus: statusCodeField,
      statusLogs: Joi.array().items(
        Joi.object().keys({
          statusCode: statusCodeField.required(),
          updatedBy: Joi.object()
            .keys({
              username: Joi.string().trim().required(),
              user: Joi.string().custom(objectId).required(),
            })
            .required(),
          updatedAt: Joi.date().iso(),
          notes: Joi.string().trim().allow('', null),
        })
      ),
      goodsReceivedDate: Joi.date().iso().allow(null),
      creditDays: Joi.number().min(0).allow(null),
      estimatedOrderDeliveryDate: Joi.any()
        .custom((value, helpers) => {
          if (value === null || value === undefined || value === '') {
            return null;
          }
          const d = new Date(value);
          if (Number.isNaN(d.getTime())) {
            return helpers.error('any.invalid');
          }
          return value;
        })
        .allow(null),
      // Optional; when omitted, existing DB values are preserved (no .default so body won't overwrite with [])
      receivedLotDetails: Joi.array()
        .items(
          Joi.object().keys({
            lotNumber: Joi.string().trim().required(),
            numberOfCones: Joi.number().min(0).allow(null),
            totalWeight: Joi.number().min(0).allow(null),
            numberOfBoxes: Joi.number().min(0).allow(null),
            poItems: Joi.array()
              .items(
                Joi.object().keys({
                  poItem: Joi.string().custom(objectId).required(),
                  receivedQuantity: Joi.number().min(0).required(),
                })
              )
              .default([]),
            status: lotStatusField.default('lot_qc_pending'),
          })
        )
        .optional(),
      packListDetails: Joi.array()
        .items(
          Joi.object().keys({
            poItems: Joi.array()
              .items(Joi.string().custom(objectId))
              .default([]),
            packingNumber: Joi.string().trim().allow('', null),
            courierName: Joi.string().trim().allow('', null),
            courierNumber: Joi.string().trim().allow('', null),
            vehicleNumber: Joi.string().trim().allow('', null),
            challanNumber: Joi.string().trim().allow('', null),
            dispatchDate: Joi.date().iso().allow(null),
            estimatedDeliveryDate: Joi.date().iso().allow(null),
            notes: Joi.string().trim().allow('', null),
            numberOfCones: Joi.number().min(0).allow(null),
            totalWeight: Joi.number().min(0).allow(null),
            numberOfBoxes: Joi.number().min(0).allow(null),
            files: Joi.array()
              .items(
                Joi.object().keys({
                  url: Joi.string().uri().required(),
                  key: Joi.string().trim().required(),
                  originalName: Joi.string().trim().required(),
                  mimeType: Joi.string().trim().required(),
                  size: Joi.number().min(0).required(),
                })
              )
              .default([]),
          })
        )
        .optional(),
      receivedBy: Joi.object()
        .keys({
          username: Joi.string().trim().allow('', null),
          user: Joi.string().custom(objectId).allow(null),
          receivedAt: Joi.date().iso().allow(null),
        })
        .optional(),
      run_pipeline: Joi.boolean().optional(),
      // Optional GRN print metadata that gets snapshotted onto a freshly-issued
      // GRN whenever this PATCH adds new lots. Ignored otherwise.
      vendorInvoiceNo: Joi.string().trim().allow('', null).optional(),
      vendorInvoiceDate: Joi.date().iso().allow(null).optional(),
      discrepancyDetails: Joi.string().trim().allow('', null).optional(),
      grnDate: Joi.date().iso().allow(null).optional(),
      // Required by the GRN module when this edit touches a lot that already
      // has an active GRN (controller validates).
      editReason: Joi.string().trim().allow('', null).optional(),
    })
    .min(1),
};

export const updatePurchaseOrderStatus = {
  params: Joi.object().keys({
    purchaseOrderId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      status_code: statusCodeField.required(),
      updated_by: Joi.object()
        .keys({
          username: Joi.string().trim().required(),
          user_id: Joi.string().custom(objectId).required(),
        })
        .required(),
      notes: Joi.string().trim().allow('', null),
    })
    .required(),
};

export const updateLotStatus = {
  params: Joi.object().keys({}),
  body: Joi.object()
    .keys({
      poNumber: Joi.string().trim().required(),
      lotNumber: Joi.string().trim().required(),
      lotStatus: lotStatusField.required(),
    })
    .required(),
};

export const updateLotStatusAndQcApprove = {
  params: Joi.object().keys({}),
  body: Joi.object()
    .keys({
      poNumber: Joi.string().trim().required(),
      lotNumber: Joi.string().trim().required(),
      lotStatus: lotStatusField.required(),
      updated_by: Joi.object()
        .keys({
          username: Joi.string().trim().required(),
          user_id: Joi.string().custom(objectId).required(),
        })
        .required(),
      notes: Joi.string().trim().allow('', null).optional(),
      remarks: Joi.string().trim().allow('', null).optional(),
      mediaUrl: Joi.object().pattern(Joi.string(), Joi.string()).allow(null).optional(),
    })
    .required(),
};

/** QC approve all lots in a PO at once */
export const qcApproveAllLots = {
  params: Joi.object()
    .keys({
      purchaseOrderId: Joi.string().custom(objectId).required(),
    })
    .required(),
  body: Joi.object()
    .keys({
      updated_by: Joi.object()
        .keys({
          username: Joi.string().trim().required(),
          user_id: Joi.string().custom(objectId).required(),
        })
        .optional(),
      notes: Joi.string().trim().allow('', null).default('QC approved all lots'),
      remarks: Joi.string().trim().allow('', null).default(''),
    })
    .default({}),
};

/** DELETE lot by poNumber and lotNumber (removes cones → boxes → lot entry) */
export const deleteLot = {
  params: Joi.object().keys({}),
  body: Joi.object()
    .keys({
      poNumber: Joi.string().trim().required(),
      lotNumber: Joi.string().trim().required(),
    })
    .required(),
};


