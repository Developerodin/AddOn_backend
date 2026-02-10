import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as styleCodeService from '../services/styleCode.service.js';

export const createStyleCode = catchAsync(async (req, res) => {
  const styleCode = await styleCodeService.createStyleCode(req.body);
  res.status(httpStatus.CREATED).send(styleCode);
});

export const getStyleCodes = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['styleCode', 'eanCode', 'brand', 'pack', 'status']);
  const search = req.query.search;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await styleCodeService.queryStyleCodes(filter, options, search);
  res.send(result);
});

export const getStyleCode = catchAsync(async (req, res) => {
  const styleCode = await styleCodeService.getStyleCodeById(req.params.styleCodeId);
  if (!styleCode) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Style code not found');
  }
  res.send(styleCode);
});

export const updateStyleCode = catchAsync(async (req, res) => {
  const styleCode = await styleCodeService.updateStyleCodeById(req.params.styleCodeId, req.body);
  res.send(styleCode);
});

export const deleteStyleCode = catchAsync(async (req, res) => {
  await styleCodeService.deleteStyleCodeById(req.params.styleCodeId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const bulkImportStyleCodes = catchAsync(async (req, res) => {
  const { styleCodes, batchSize = 50 } = req.body;
  const results = await styleCodeService.bulkImportStyleCodes(styleCodes, batchSize);
  res.status(httpStatus.OK).send({
    message: 'Bulk import completed',
    ...results,
  });
});
