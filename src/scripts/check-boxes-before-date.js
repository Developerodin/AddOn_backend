#!/usr/bin/env node
import mongoose from 'mongoose';
import { YarnBox } from '../models/index.js';
import { LT_SECTION_CODES } from '../models/storageManagement/storageSlot.model.js';
import config from '../config/config.js';

const LT_REGEX = new RegExp(`^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`, 'i');
const BEFORE = new Date(2026, 1, 1); // Feb 1 2026

const run = async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  const inLT = await YarnBox.countDocuments({
    storageLocation: { $regex: LT_REGEX },
    storedStatus: true,
    'qcData.status': 'qc_approved',
    boxWeight: { $gt: 0 },
  });
  const beforeDate = await YarnBox.countDocuments({
    storageLocation: { $regex: LT_REGEX },
    storedStatus: true,
    'qcData.status': 'qc_approved',
    boxWeight: { $gt: 0 },
    createdAt: { $lte: BEFORE },
  });
  const sample = await YarnBox.find({
    storageLocation: { $regex: LT_REGEX },
    storedStatus: true,
    boxWeight: { $gt: 0 },
  })
    .select('yarnName createdAt receivedDate')
    .limit(5)
    .lean();

  console.log('Boxes in LT storage (qc approved, weight>0):', inLT);
  console.log('Boxes with createdAt <= Feb 1 2026:', beforeDate);
  console.log('Sample:', JSON.stringify(sample, null, 2));
  await mongoose.disconnect();
};
run().catch(console.error);
