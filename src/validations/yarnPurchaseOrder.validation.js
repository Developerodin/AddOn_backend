import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { yarnPurchaseOrderStatuses, lotStatuses } from '../models/yarnReq/yarnPurchaseOrder.model.js';

const statusCodeField = Joi.string().valid(...yarnPurchaseOrderStatuses);
const lotStatusField = Joi.string().valid(...lotStatuses);

const poItemSchema = Joi.object().keys({
  yarnName: Joi.string().trim(),
  yarn: Joi.string().custom(objectId).required(),
  sizeCount: Joi.string().trim().required(),
  shadeCode: Joi.string().trim().allow('', null),
  rate: Joi.number().min(0).required(),
  quantity: Joi.number().min(0).required(),
  estimatedDeliveryDate: Joi.date().iso().allow(null),
  gstRate: Joi.number().min(0).allow(null),
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
      supplierName: Joi.string().trim().required(),
      supplier: Joi.string().custom(objectId).required(),
      poItems: Joi.array().items(poItemSchema).min(1).required(),
      notes: Joi.string().trim().allow('', null),
      subTotal: Joi.number().min(0).required(),
      gst: Joi.number().min(0).required(),
      total: Joi.number().min(0).required(),
      currentStatus: statusCodeField.default('submitted_to_supplier'),
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
    .required(),
};

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
      supplier: Joi.string().custom(objectId),
      poItems: Joi.array().items(poItemSchema).min(1),
      notes: Joi.string().trim().allow('', null),
      subTotal: Joi.number().min(0),
      gst: Joi.number().min(0),
      total: Joi.number().min(0),
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
        .default([]),
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
        .default([]),
      receivedBy: Joi.object().keys({
        username: Joi.string().trim().allow('', null),
        user: Joi.string().custom(objectId).allow(null),
        receivedAt: Joi.date().iso().allow(null),
      }),
      run_pipeline: Joi.boolean().optional(),
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


