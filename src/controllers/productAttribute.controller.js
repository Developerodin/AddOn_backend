import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import { productAttributeService } from '../services/index.js';
import ApiError from '../utils/ApiError.js';
import pick from '../utils/pick.js';

const createProductAttribute = catchAsync(async (req, res) => {
  const attribute = await productAttributeService.createProductAttribute(req.body);
  res.status(httpStatus.CREATED).send(attribute);
});

const getProductAttributes = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'type']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await productAttributeService.queryProductAttributes(filter, options);
  res.send(result);
});

const getProductAttribute = catchAsync(async (req, res) => {
  const attribute = await productAttributeService.getProductAttributeById(req.params.attributeId);
  if (!attribute) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product attribute not found');
  }
  res.send(attribute);
});

const updateProductAttribute = catchAsync(async (req, res) => {
  const attribute = await productAttributeService.updateProductAttributeById(req.params.attributeId, req.body);
  res.send(attribute);
});

const deleteProductAttribute = catchAsync(async (req, res) => {
  await productAttributeService.deleteProductAttributeById(req.params.attributeId);
  res.status(httpStatus.NO_CONTENT).send();
});

export default {
  createProductAttribute,
  getProductAttributes,
  getProductAttribute,
  updateProductAttribute,
  deleteProductAttribute,
}; 