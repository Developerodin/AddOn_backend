import mongoose from 'mongoose';
import validator from 'validator';
import toJSON from './plugins/toJSON.plugin.js';
import paginate from './plugins/paginate.plugin.js';

const sealsExcelMasterSchema = mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    fileUrl: {
      type: String,
      required: true,
      trim: true,
      validate(value) {
        if (!validator.isURL(value)) {
          throw new Error('Invalid file URL');
        }
      },
    },
    fileKey: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    uploadedBy: {
      type: String,
    },
    fileSize: {
      type: Number,
    },
    mimeType: {
      type: String,
      enum: [
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv'
      ],
      default: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    processingStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    errorMessage: {
      type: String,
      trim: true,
    },
    recordsCount: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Add plugins for converting MongoDB document to JSON and pagination support
sealsExcelMasterSchema.plugin(toJSON);
sealsExcelMasterSchema.plugin(paginate);

/**
 * Check if file key is taken
 * @param {string} fileKey - The file key
 * @param {ObjectId} [excludeId] - The id of the record to be excluded
 * @returns {Promise<boolean>}
 */
sealsExcelMasterSchema.statics.isFileKeyTaken = async function (fileKey, excludeId) {
  const record = await this.findOne({ fileKey, _id: { $ne: excludeId } });
  return !!record;
};

/**
 * Get uploads by user
 * @param {ObjectId} userId - The user ID
 * @param {Object} options - Query options
 * @returns {Promise<QueryResult>}
 */
sealsExcelMasterSchema.statics.getByUser = async function (userId, options = {}) {
  return this.paginate({ uploadedBy: userId, isActive: true }, options);
};

/**
 * Get recent uploads
 * @param {number} limit - Number of records to fetch
 * @returns {Promise<Array>}
 */
sealsExcelMasterSchema.statics.getRecentUploads = async function (limit = 10) {
  return this.find({ isActive: true })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('uploadedBy', 'name email');
};

/**
 * @typedef SealsExcelMaster
 */
const SealsExcelMaster = mongoose.model('SealsExcelMaster', sealsExcelMasterSchema);

export default SealsExcelMaster; 