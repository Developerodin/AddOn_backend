import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const createSealsExcelMaster = {
  body: Joi.object().keys({
    fileName: Joi.string().required().trim(),
    description: Joi.string().optional().trim().allow(''),
    fileUrl: Joi.string().uri().required(),
    fileKey: Joi.string().required().trim(),
    data: Joi.any().required(),
    uploadedBy: Joi.string().required(),
    fileSize: Joi.number().optional(),
    mimeType: Joi.string().valid(
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv'
    ).optional(),
    processingStatus: Joi.string().valid('pending', 'processing', 'completed', 'failed').optional(),
    recordsCount: Joi.number().integer().min(0).optional(),
    isActive: Joi.boolean().optional(),
  }),
};

export const getSealsExcelMasters = {
  query: Joi.object().keys({
    fileName: Joi.string().optional(),
    description: Joi.string().optional(),
    fileKey: Joi.string().optional(),
    uploadedBy: Joi.string().optional(),
    processingStatus: Joi.string().valid('pending', 'processing', 'completed', 'failed').optional(),
    mimeType: Joi.string().optional(),
    isActive: Joi.boolean().optional(),
    sortBy: Joi.string().optional(),
    limit: Joi.number().integer().optional(),
    page: Joi.number().integer().optional(),
    populate: Joi.string().optional(),
  }),
};

export const getSealsExcelMaster = {
  params: Joi.object().keys({
    sealsExcelId: Joi.string().custom(objectId).required(),
  }),
};

export const updateSealsExcelMaster = {
  params: Joi.object().keys({
    sealsExcelId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      fileName: Joi.string().optional().trim(),
      description: Joi.string().optional().trim().allow(''),
      fileUrl: Joi.string().uri().optional(),
      fileKey: Joi.string().optional().trim(),
      data: Joi.any().optional(),
      uploadedBy: Joi.string().optional(),
      fileSize: Joi.number().optional(),
      mimeType: Joi.string().valid(
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv'
      ).optional(),
      processingStatus: Joi.string().valid('pending', 'processing', 'completed', 'failed').optional(),
      errorMessage: Joi.string().optional().trim().allow(''),
      recordsCount: Joi.number().integer().min(0).optional(),
      isActive: Joi.boolean().optional(),
    })
    .min(1),
};

export const deleteSealsExcelMaster = {
  params: Joi.object().keys({
    sealsExcelId: Joi.string().custom(objectId).required(),
  }),
};

export const getSealsExcelMastersByUser = {
  params: Joi.object().keys({
    userId: Joi.string().optional(),
  }),
  query: Joi.object().keys({
    sortBy: Joi.string().optional(),
    limit: Joi.number().integer().optional(),
    page: Joi.number().integer().optional(),
    populate: Joi.string().optional(),
  }),
};

export const getRecentUploads = {
  query: Joi.object().keys({
    limit: Joi.number().integer().min(1).max(100).optional(),
  }),
};

export const updateProcessingStatus = {
  params: Joi.object().keys({
    sealsExcelId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    status: Joi.string().valid('pending', 'processing', 'completed', 'failed').required(),
    errorMessage: Joi.string().optional().trim().allow(''),
  }),
};

export const bulkImportSealsExcelMasters = {
  body: Joi.object().keys({
    records: Joi.array().items(
      Joi.object().keys({
        id: Joi.string().custom(objectId).optional(),
        fileName: Joi.string().required().trim(),
        description: Joi.string().optional().trim().allow(''),
        fileUrl: Joi.string().uri().required(),
        fileKey: Joi.string().required().trim(),
        data: Joi.any().required(),
        uploadedBy: Joi.string().required(),
        fileSize: Joi.number().optional(),
        mimeType: Joi.string().valid(
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv'
        ).optional(),
        processingStatus: Joi.string().valid('pending', 'processing', 'completed', 'failed').optional(),
        recordsCount: Joi.number().integer().min(0).optional(),
        isActive: Joi.boolean().optional(),
      })
    ).min(1).max(1000).required(),
    batchSize: Joi.number().integer().min(1).max(100).optional(),
  }),
}; 