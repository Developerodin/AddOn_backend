import mongoose from 'mongoose';

const faqVectorSchema = mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
      trim: true,
    },
    answer: {
      type: String,
      required: true,
      trim: true,
    },
    embedding: {
      type: [Number],
      required: true,
      validate: {
        validator: function(v) {
          return Array.isArray(v) && v.length > 0 && v.every(n => typeof n === 'number');
        },
        message: 'Embedding must be a non-empty array of numbers'
      }
    }
  },
  {
    timestamps: true,
  }
);

// Index for vector similarity search
faqVectorSchema.index({ embedding: '2dsphere' });

// Add pagination plugin
import toJSON from './plugins/toJSON.plugin.js';
import paginate from './plugins/paginate.plugin.js';

faqVectorSchema.plugin(toJSON);
faqVectorSchema.plugin(paginate);

const FaqVector = mongoose.model('FaqVector', faqVectorSchema);

export default FaqVector;
