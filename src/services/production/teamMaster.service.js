import httpStatus from 'http-status';
import TeamMaster from '../../models/production/teamMaster.model.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Create a team member. Barcode is set from _id in model pre-save.
 * @param {Object} body
 * @returns {Promise<TeamMaster>}
 */
export const createTeamMaster = async (body) => {
  const doc = await TeamMaster.create(body);
  if (!doc.barcode && doc._id) {
    doc.barcode = doc._id.toString();
    await doc.save();
  }
  return doc;
};

/**
 * Query team members with filter (workingFloor, role, status, search) and pagination.
 * @param {Object} filter
 * @param {Object} options - sortBy, limit, page
 * @returns {Promise<QueryResult>}
 */
export const queryTeamMasters = async (filter, options = {}) => {
  const { workingFloor, role, status, teamMemberName, search, ...rest } = filter || {};
  const query = { ...rest };
  if (workingFloor) query.workingFloor = workingFloor;
  if (role) query.role = role;
  if (status) query.status = status;
  if (teamMemberName) query.teamMemberName = { $regex: teamMemberName, $options: 'i' };
  if (search && String(search).trim()) {
    const term = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(term, 'i');
    query.$or = [
      { teamMemberName: re },
      { contactNumber: re },
      { barcode: re },
    ];
  }
  return TeamMaster.paginate(query, options);
};

/**
 * Add article as active article for a team member (push to articleData).
 * @param {string} teamMemberId
 * @param {string} articleId
 * @returns {Promise<TeamMaster>}
 */
export const addActiveArticle = async (teamMemberId, articleId) => {
  const doc = await TeamMaster.findById(teamMemberId);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found');
  if (!Array.isArray(doc.articleData)) doc.articleData = [];
  doc.articleData.push({ activeArticle: articleId });
  doc.markModified('articleData');
  await doc.save();
  return doc;
};

/**
 * Remove active article from team member and append a log entry with timestamp.
 * @param {string} teamMemberId
 * @param {string} articleId
 * @returns {Promise<TeamMaster>}
 */
export const removeActiveArticle = async (teamMemberId, articleId) => {
  const doc = await TeamMaster.findById(teamMemberId);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found');
  if (!Array.isArray(doc.articleData)) doc.articleData = [];
  const before = doc.articleData.length;
  doc.articleData = doc.articleData.filter(
    (item) => item.activeArticle && item.activeArticle.toString() !== articleId
  );
  const removed = before !== doc.articleData.length;
  if (!Array.isArray(doc.logs)) doc.logs = [];
  doc.logs.push({
    articleId,
    action: 'activeArticleRemoved',
    timestamp: new Date(),
  });
  doc.markModified('articleData');
  doc.markModified('logs');
  await doc.save();
  return doc;
};

/**
 * Get team member by id.
 * @param {string} id
 * @returns {Promise<TeamMaster|null>}
 */
export const getTeamMasterById = async (id) => {
  return TeamMaster.findById(id).populate('myTeam', 'teamMemberName contactNumber role workingFloor');
};

/**
 * Get team member by barcode (barcode stores the _id string).
 * @param {string} barcode
 * @returns {Promise<TeamMaster|null>}
 */
export const getTeamMemberByBarcode = async (barcode) => {
  if (!barcode || !String(barcode).trim()) return null;
  const trimmed = String(barcode).trim();
  const byBarcode = await TeamMaster.findOne({ barcode: trimmed })
    .populate('myTeam', 'teamMemberName contactNumber role workingFloor');
  if (byBarcode) return byBarcode;
  if (/^[0-9a-fA-F]{24}$/.test(trimmed)) {
    return TeamMaster.findById(trimmed)
      .populate('myTeam', 'teamMemberName contactNumber role workingFloor');
  }
  return null;
};

/**
 * Update team member by id.
 * @param {string} id
 * @param {Object} updateBody
 * @returns {Promise<TeamMaster>}
 */
export const updateTeamMasterById = async (id, updateBody) => {
  const doc = await TeamMaster.findById(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found');
  Object.assign(doc, updateBody);
  await doc.save();
  return doc;
};

/**
 * Delete team member by id.
 * @param {string} id
 * @returns {Promise<TeamMaster>}
 */
export const deleteTeamMasterById = async (id) => {
  const doc = await TeamMaster.findById(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found');
  await doc.deleteOne();
  return doc;
};
