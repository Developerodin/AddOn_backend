import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import { rawMaterialService } from '../services/index.js';
import ApiError from '../utils/ApiError.js';
import pick from '../utils/pick.js';

const createRawMaterial = catchAsync(async (req, res) => {
  const material = await rawMaterialService.createRawMaterial(req.body);
  res.status(httpStatus.CREATED).send(material);
});

const getRawMaterials = catchAsync(async (req, res) => {
  const filter = pick(req.query, [
    'name', 'groupName', 'type', 'brand', 'countSize', 'material', 'color', 'shade', 'unit', 'mrp', 'hsnCode', 'gst', 'articleNo'
  ]);
  const options = pick(req.query, [
    'sortBy', 'limit', 'page'
  ]);
  const result = await rawMaterialService.queryRawMaterials(filter, options);
  res.send(result);
});

const getRawMaterial = catchAsync(async (req, res) => {
  const material = await rawMaterialService.getRawMaterialById(req.params.materialId);
  if (!material) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Raw material not found');
  }
  res.send(material);
});

const updateRawMaterial = catchAsync(async (req, res) => {
  const material = await rawMaterialService.updateRawMaterialById(req.params.materialId, req.body);
  res.send(material);
});

const deleteRawMaterial = catchAsync(async (req, res) => {
  await rawMaterialService.deleteRawMaterialById(req.params.materialId);
  res.status(httpStatus.NO_CONTENT).send();
});

export default {
  createRawMaterial,
  getRawMaterials,
  getRawMaterial,
  updateRawMaterial,
  deleteRawMaterial,
}; 