import { YarnTransaction } from '../../models/index.js';

export const createYarnTransaction = async (transactionBody) => {
  const transaction = await YarnTransaction.create(transactionBody);
  return transaction;
};

export const queryYarnTransactions = async (filters = {}) => {
  const mongooseFilter = {};

  if (filters.transaction_type) {
    mongooseFilter.transactionType = filters.transaction_type;
  }

  if (filters.yarn_id) {
    mongooseFilter.yarn = filters.yarn_id;
  }

  if (filters.yarn_name) {
    mongooseFilter.yarnName = { $regex: filters.yarn_name, $options: 'i' };
  }

  if (filters.start_date || filters.end_date) {
    mongooseFilter.transactionDate = {};
    if (filters.start_date) {
      const start = new Date(filters.start_date);
      start.setHours(0, 0, 0, 0);
      mongooseFilter.transactionDate.$gte = start;
    }
    if (filters.end_date) {
      const end = new Date(filters.end_date);
      end.setHours(23, 59, 59, 999);
      mongooseFilter.transactionDate.$lte = end;
    }
  }

  const transactions = await YarnTransaction.find(mongooseFilter)
    .populate({
      path: 'yarn',
      select: '_id yarnName yarnType status',
    })
    .sort({ transactionDate: -1 })
    .lean();

  return transactions;
};


