import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { ProductionFloor, TeamRole, TeamMemberStatus } from '../models/production/enums.js';

const workingFloorValues = Object.values(ProductionFloor);
const roleValues = Object.values(TeamRole);
const statusValues = Object.values(TeamMemberStatus);

export const createTeamMaster = {
  body: Joi.object().keys({
    teamMemberName: Joi.string().required().trim(),
    contactNumber: Joi.string().trim().allow('', null),
    workingFloor: Joi.string()
      .required()
      .valid(...workingFloorValues),
    myTeam: Joi.array().items(Joi.string().custom(objectId)).default([]),
    role: Joi.string()
      .valid(...roleValues)
      .default(TeamRole.TEAM_MEMBER),
    status: Joi.string()
      .valid(...statusValues)
      .default(TeamMemberStatus.ACTIVE),
  }),
};

export const getTeamMasters = {
  query: Joi.object().keys({
    teamMemberName: Joi.string().trim(),
    workingFloor: Joi.string().valid(...workingFloorValues),
    role: Joi.string().valid(...roleValues),
    status: Joi.string().valid(...statusValues),
    search: Joi.string().trim(),
    sortBy: Joi.string(),
    limit: Joi.number().integer().min(1),
    page: Joi.number().integer().min(1),
  }),
};

export const getTeamMaster = {
  params: Joi.object().keys({
    teamMemberId: Joi.string().custom(objectId).required(),
  }),
};

/** Add article as active article for team member */
export const addActiveArticle = {
  params: Joi.object().keys({
    teamMemberId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    articleId: Joi.string().custom(objectId).required(),
  }),
};

/** Remove active article and log removal with timestamp */
export const removeActiveArticle = {
  params: Joi.object().keys({
    teamMemberId: Joi.string().custom(objectId).required(),
    articleId: Joi.string().custom(objectId).required(),
  }),
};

export const getTeamMemberByBarcode = {
  params: Joi.object().keys({
    barcode: Joi.string().trim().required(),
  }),
};

export const updateTeamMaster = {
  params: Joi.object().keys({
    teamMemberId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      teamMemberName: Joi.string().trim(),
      contactNumber: Joi.string().trim().allow('', null),
      workingFloor: Joi.string().valid(...workingFloorValues),
      myTeam: Joi.array().items(Joi.string().custom(objectId)),
      role: Joi.string().valid(...roleValues),
      status: Joi.string().valid(...statusValues),
    })
    .min(1),
};

export const deleteTeamMaster = {
  params: Joi.object().keys({
    teamMemberId: Joi.string().custom(objectId).required(),
  }),
};
