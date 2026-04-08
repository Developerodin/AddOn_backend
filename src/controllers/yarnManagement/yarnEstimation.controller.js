import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as yarnEstimationService from '../../services/yarnManagement/yarnEstimation.service.js';

export const getYarnEstimationByOrder = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const includeTransactions = req.query.include_transactions === 'true';
  const result = await yarnEstimationService.getYarnEstimationByOrder(orderId, { includeTransactions });
  res.status(httpStatus.OK).send(result);
});

export const getYarnEstimationByArticle = catchAsync(async (req, res) => {
  const { articleId } = req.params;
  const includeTransactions = req.query.include_transactions === 'true';
  const result = await yarnEstimationService.getYarnEstimationByArticle(articleId, { includeTransactions });
  res.status(httpStatus.OK).send(result);
});

export const getYarnEstimationSummary = catchAsync(async (req, res) => {
  const filters = {
    status: req.query.status,
    search: req.query.search,
    limit: req.query.limit ? parseInt(req.query.limit, 10) : 50,
    page: req.query.page ? parseInt(req.query.page, 10) : 1,
  };
  const result = await yarnEstimationService.getYarnEstimationSummary(filters);
  res.status(httpStatus.OK).send(result);
});
