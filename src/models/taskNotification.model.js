import mongoose from 'mongoose';
import toJSON from './plugins/toJSON.plugin.js';

const taskNotificationSchema = mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
    type: { type: String, enum: ['assigned', 'completed', 'status', 'comment', 'attachment'], required: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

taskNotificationSchema.index({ user: 1, type: 1, readAt: 1, createdAt: -1 });
taskNotificationSchema.plugin(toJSON);

const TaskNotification = mongoose.model('TaskNotification', taskNotificationSchema);

export default TaskNotification;
