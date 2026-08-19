/* eslint-disable no-param-reassign */

/**
 * A mongoose schema plugin which applies the following in the toJSON transform call:
 *  - removes __v, createdAt, updatedAt, and any path that has private: true
 *  - replaces _id with id
 */

const deleteAtPath = (obj, path, index) => {
  if (index === path.length - 1) {
    delete obj[path[index]];
    return;
  }
  deleteAtPath(obj[path[index]], path, index + 1);
};

const toJSON = (schema) => {
  let transform;
  if (schema.options.toJSON && schema.options.toJSON.transform) {
    transform = schema.options.toJSON.transform;
  }

  schema.options.toJSON = Object.assign(schema.options.toJSON || {}, {
    transform(doc, ret, options) {
      Object.keys(schema.paths).forEach((path) => {
        if (schema.paths[path].options && schema.paths[path].options.private) {
          deleteAtPath(ret, path.split('.'), 0);
        }
      });

      // Defensive: handle null _id
      ret.id = ret._id != null ? ret._id.toString() : null;
      delete ret._id;
      delete ret.__v;

      // Only delete timestamps for specific models that don't need them
      // Keep timestamps for production orders, yarn management models, and other models that need them
      const modelsWithTimestamps = [
        'ProductionOrder',
        'Article',
        'Color',
        'CountSize',
        'YarnType',
        'Supplier',
        'Blend',
        'YarnCatalog',
        'YarnOrder',
        'UserActivityLog',
        'InwardReceive',
        'WarehouseInventory',
        'WarehouseInventoryLog',
        'WarehouseClient',
        'WarehouseOrder',
        'PickListBatch',
        'HelpSupportTicket',
        'VendorBox',
      ];
      // Get model name from document constructor or schema
      const modelName = doc?.constructor?.modelName || schema.modelName;
      if (!modelsWithTimestamps.includes(modelName)) {
        delete ret.createdAt;
        delete ret.updatedAt;
      }

      // Handle nested file and folder objects
      if (ret.file && typeof ret.file === 'object') {
        if (ret.file._id) {
          ret.file.id = ret.file._id.toString();
          delete ret.file._id;
        }
        delete ret.file.__v;
      }

      if (ret.folder && typeof ret.folder === 'object') {
        if (ret.folder._id) {
          ret.folder.id = ret.folder._id.toString();
          delete ret.folder._id;
        }
        delete ret.folder.__v;
      }

      if (transform) {
        return transform(doc, ret, options);
      }
    },
  });
};

export default toJSON;
