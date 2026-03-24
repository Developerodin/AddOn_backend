import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const createVendorBox = {
  body: Joi.object().keys({
    boxId: Joi.string().trim(),
    vpoNumber: Joi.string().required().trim(),
    vendorPurchaseOrderId: Joi.string().custom(objectId).required(),
    vendor: Joi.string().custom(objectId),
    vendorPoItemId: Joi.string().custom(objectId),
    receivedDate: Joi.date(),
    orderDate: Joi.date(),
    productId: Joi.string().custom(objectId),
    productName: Joi.string().trim(),
    lotNumber: Joi.string().trim(),
    orderQty: Joi.number().min(0),
    boxWeight: Joi.number().min(0),
    grossWeight: Joi.number().min(0),
    barcode: Joi.string().trim(),
    numberOfUnits: Joi.number().min(0),
    tearweight: Joi.number().min(0),
    qcData: Joi.object().keys({
      user: Joi.string().custom(objectId),
      username: Joi.string().trim(),
      date: Joi.date(),
      remarks: Joi.string().trim(),
      status: Joi.string().trim(),
    }),
    storageLocation: Joi.string().trim(),
    storedStatus: Joi.boolean(),
  }),
};

export const bulkCreateVendorBoxes = {
  body: Joi.object().keys({
    vpoNumber: Joi.string().required().trim(),
    lotDetails: Joi.array()
      .items(
        Joi.object().keys({
          lotNumber: Joi.string().required().trim(),
          numberOfBoxes: Joi.number().integer().min(1).required(),
          productId: Joi.string().custom(objectId),
          vendorPoItemId: Joi.string().custom(objectId),
          orderQty: Joi.number().min(0),
          boxWeight: Joi.number().min(0),
          grossWeight: Joi.number().min(0),
          numberOfUnits: Joi.number().min(0),
          tearweight: Joi.number().min(0),
        })
      )
      .min(1)
      .required(),
  }),
};

export const getVendorBoxes = {
  query: Joi.object().keys({
    vpoNumber: Joi.string(),
    vendorPurchaseOrderId: Joi.string().custom(objectId),
    vendor: Joi.string().custom(objectId),
    productName: Joi.string(),
    lotNumber: Joi.string(),
    storedStatus: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false')),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    populate: Joi.string().valid('productId'),
  }),
};

export const getVendorBoxById = {
  params: Joi.object().keys({
    vendorBoxId: Joi.string().custom(objectId).required(),
  }),
};

export const updateVendorBox = {
  params: Joi.object().keys({
    vendorBoxId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      boxId: Joi.string().trim(),
      vpoNumber: Joi.string().trim(),
      vendorPurchaseOrderId: Joi.string().custom(objectId),
      vendor: Joi.string().custom(objectId),
      vendorPoItemId: Joi.string().custom(objectId),
      receivedDate: Joi.date(),
      orderDate: Joi.date(),
      productId: Joi.string().custom(objectId),
      productName: Joi.string().trim(),
      lotNumber: Joi.string().trim(),
      orderQty: Joi.number().min(0),
      boxWeight: Joi.number().min(0),
      grossWeight: Joi.number().min(0),
      barcode: Joi.string().trim(),
      numberOfUnits: Joi.number().min(0),
      tearweight: Joi.number().min(0),
      qcData: Joi.object(),
      storageLocation: Joi.string().trim(),
      storedStatus: Joi.boolean(),
    })
    .min(1),
};

export const deleteVendorBox = {
  params: Joi.object().keys({
    vendorBoxId: Joi.string().custom(objectId).required(),
  }),
};
