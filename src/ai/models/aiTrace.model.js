import mongoose from 'mongoose';

/**
 * One model/tool round recorded for a chat request.
 * No TTL. User activity logs expire after 30 days; these do not.
 */
const aiToolCallSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    input: { type: mongoose.Schema.Types.Mixed },
    output: { type: mongoose.Schema.Types.Mixed },
    ms: { type: Number },
    error: { type: String, default: null },
  },
  { _id: false }
);

const aiTraceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    message: { type: String, default: '' },
    model: { type: String, required: true },
    promptVersion: { type: String, required: true },
    toolCalls: { type: [aiToolCallSchema], default: [] },
    answer: { type: String, default: '' },
    tokens: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Request-level failure. Tool failures stay on toolCalls[].error. */
    error: { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'aitraces',
  }
);

aiTraceSchema.index({ createdAt: -1 });
aiTraceSchema.index({ userId: 1, createdAt: -1 });

const AiTrace = mongoose.model('AiTrace', aiTraceSchema);

export default AiTrace;
