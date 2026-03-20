import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as styleCodePairsService from '../services/styleCodePairs.service.js';

export const createStyleCodePairs = catchAsync(async (req, res) => {
  const doc = await styleCodePairsService.createStyleCodePairs(req.body);
  res.status(httpStatus.CREATED).send(doc);
});

export const getStyleCodePairsList = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['pairStyleCode', 'eanCode', 'status']);
  const search = req.query.search;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await styleCodePairsService.queryStyleCodePairs(filter, options, search);
  res.send(result);
});

export const getStyleCodePairs = catchAsync(async (req, res) => {
  const doc = await styleCodePairsService.getStyleCodePairsById(req.params.styleCodePairsId);
  if (!doc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Style code pairs not found');
  }
  res.send(doc);
});

export const updateStyleCodePairs = catchAsync(async (req, res) => {
  const doc = await styleCodePairsService.updateStyleCodePairsById(
    req.params.styleCodePairsId,
    req.body
  );
  res.send(doc);
});

export const deleteStyleCodePairs = catchAsync(async (req, res) => {
  await styleCodePairsService.deleteStyleCodePairsById(req.params.styleCodePairsId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const bulkImportStyleCodePairs = catchAsync(async (req, res) => {
  const { items, batchSize = 50 } = req.body;
  const results = await styleCodePairsService.bulkImportStyleCodePairs(items, batchSize);
  res.status(httpStatus.OK).send({
    message: 'Bulk import completed',
    ...results,
  });
});

export const bulkImportBom = catchAsync(async (req, res) => {
  const { items, batchSize = 50 } = req.body;
  const results = await styleCodePairsService.bulkImportBom(items, batchSize);
  res.status(httpStatus.OK).send({
    message: 'Bulk BOM import completed',
    ...results,
  });
});
