import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import * as teamMasterService from '../../services/production/teamMaster.service.js';

const createTeamMaster = catchAsync(async (req, res) => {
  const doc = await teamMasterService.createTeamMaster(req.body);
  res.status(httpStatus.CREATED).send(doc);
});

const getTeamMasters = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['teamMemberName', 'workingFloor', 'role', 'status', 'search']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await teamMasterService.queryTeamMasters(filter, options);
  res.send(result);
});

const getTeamMaster = catchAsync(async (req, res) => {
  const doc = await teamMasterService.getTeamMasterById(req.params.teamMemberId);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found');
  res.send(doc);
});

const getTeamMemberByBarcode = catchAsync(async (req, res) => {
  const doc = await teamMasterService.getTeamMemberByBarcode(req.params.barcode);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found for this barcode');
  res.send(doc);
});

const updateTeamMaster = catchAsync(async (req, res) => {
  const doc = await teamMasterService.updateTeamMasterById(req.params.teamMemberId, req.body);
  res.send(doc);
});

const addActiveArticle = catchAsync(async (req, res) => {
  const doc = await teamMasterService.addActiveArticle(req.params.teamMemberId, req.body.articleId);
  res.send(doc);
});

const removeActiveArticle = catchAsync(async (req, res) => {
  const doc = await teamMasterService.removeActiveArticle(req.params.teamMemberId, req.params.articleId);
  res.send(doc);
});

const deleteTeamMaster = catchAsync(async (req, res) => {
  await teamMasterService.deleteTeamMasterById(req.params.teamMemberId);
  res.status(httpStatus.NO_CONTENT).send();
});

export {
  createTeamMaster,
  getTeamMasters,
  getTeamMaster,
  getTeamMemberByBarcode,
  updateTeamMaster,
  addActiveArticle,
  removeActiveArticle,
  deleteTeamMaster,
};
