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
      console.log('🔄 toJSON Plugin - Before transform:', JSON.stringify(ret, null, 2));
      
      Object.keys(schema.paths).forEach((path) => {
        if (schema.paths[path].options && schema.paths[path].options.private) {
          deleteAtPath(ret, path.split('.'), 0);
        }
      });

      // Defensive: handle null _id
      ret.id = ret._id != null ? ret._id.toString() : null;
      delete ret._id;
      delete ret.__v;
      delete ret.createdAt;
      delete ret.updatedAt;
      
      // Handle nested file and folder objects
      if (ret.file && typeof ret.file === 'object') {
        console.log('📁 toJSON Plugin - Processing file object:', JSON.stringify(ret.file, null, 2));
        if (ret.file._id) {
          ret.file.id = ret.file._id.toString();
          delete ret.file._id;
        }
        delete ret.file.__v;
        // Keep createdAt and updatedAt for file objects
        console.log('📁 toJSON Plugin - File object after processing:', JSON.stringify(ret.file, null, 2));
      } else {
        console.log('❌ toJSON Plugin - File object is null or undefined:', ret.file);
      }
      
      if (ret.folder && typeof ret.folder === 'object') {
        console.log('📂 toJSON Plugin - Processing folder object:', JSON.stringify(ret.folder, null, 2));
        if (ret.folder._id) {
          ret.folder.id = ret.folder._id.toString();
          delete ret.folder._id;
        }
        delete ret.folder.__v;
        // Keep createdAt and updatedAt for folder objects
        console.log('📂 toJSON Plugin - Folder object after processing:', JSON.stringify(ret.folder, null, 2));
      }
      
      console.log('🔄 toJSON Plugin - After transform:', JSON.stringify(ret, null, 2));
      
      if (transform) {
        return transform(doc, ret, options);
      }
    },
  });
};

export default toJSON;

