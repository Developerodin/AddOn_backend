import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import * as yarnTransactionService from '../../services/yarnManagement/yarnTransaction.service.js';

export const createYarnTransaction = catchAsync(async (req, res) => {
  const transaction = await yarnTransactionService.createYarnTransaction(req.body);
  res.status(httpStatus.CREATED).send(transaction);
});

export const getYarnTransactions = catchAsync(async (req, res) => {
  const filters = pick(req.query, ['start_date', 'end_date', 'transaction_type', 'yarn_id', 'yarn_name', 'orderno']);
  const transactions = await yarnTransactionService.queryYarnTransactions(filters);
  res.status(httpStatus.OK).send(transactions);
});

export const getYarnIssuedByOrder = catchAsync(async (req, res) => {
  const { orderno } = req.params;
  const transactions = await yarnTransactionService.getYarnIssuedByOrder(orderno);
  res.status(httpStatus.OK).send(transactions);
});

export const getAllYarnIssued = catchAsync(async (req, res) => {
  const filters = pick(req.query, ['start_date', 'end_date']);
  const transactions = await yarnTransactionService.getAllYarnIssued(filters);
  res.status(httpStatus.OK).send(transactions);
});


