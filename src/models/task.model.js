import mongoose from 'mongoose';
import toJSON from './plugins/toJSON.plugin.js';

const fileRefSchema = mongoose.Schema(
  {
    url: { type: String, required: true },
    key: { type: String, default: '' },
    name: { type: String, required: true },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
  },
  { _id: false }
);

const timelineSchema = mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['created', 'status_change', 'comment', 'attachment'],
      required: true,
    },
    message: { type: String, required: true, trim: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true },
    fromStatus: { type: String },
    toStatus: { type: String },
  },
  { _id: true }
);

const taskSchema = mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', trim: true, maxlength: 5000 },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'follow_up', 'hold', 'done', 'cancelled'],
      default: 'open',
      index: true,
    },
    dueDate: { type: Date, default: null },
    images: { type: [fileRefSchema], default: [] },
    attachments: { type: [fileRefSchema], default: [] },
    timeline: { type: [timelineSchema], default: [] },
  },
  { timestamps: true }
);

taskSchema.index({ assignee: 1, status: 1, createdAt: -1 });

taskSchema.options.toJSON = {
  transform(doc, ret) {
    if (Array.isArray(ret.timeline)) {
      ret.timeline = ret.timeline.map((entry) => {
        const next = { ...entry };
        if (next._id) {
          next.id = next._id.toString();
          delete next._id;
        }
        return next;
      });
    }
    return ret;
  },
};

taskSchema.plugin(toJSON);

const Task = mongoose.model('Task', taskSchema);

export default Task;
