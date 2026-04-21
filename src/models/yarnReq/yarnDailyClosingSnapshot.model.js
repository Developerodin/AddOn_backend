import mongoose from 'mongoose';

const yarnDailyClosingSnapshotSchema = mongoose.Schema(
  {
    snapshotDate: { type: String, required: true }, // YYYY-MM-DD in business timezone
    yarnCatalogId: { type: mongoose.Schema.Types.ObjectId, ref: 'YarnCatalog', required: true },
    closingKg: { type: Number, required: true },
    computedAt: { type: Date, default: Date.now },
    source: { type: String, default: 'cron' },
  },
  { timestamps: false }
);

yarnDailyClosingSnapshotSchema.index({ snapshotDate: 1, yarnCatalogId: 1 }, { unique: true });

const YarnDailyClosingSnapshot = mongoose.model('YarnDailyClosingSnapshot', yarnDailyClosingSnapshotSchema);

export default YarnDailyClosingSnapshot;
