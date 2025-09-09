import httpStatus from 'http-status';

import ApiError from '../utils/ApiError.js';
import User from '../models/user.model.js';
import { getDefaultNavigationByRole, mergeNavigation, validateNavigationStructure } from '../utils/navigationHelper.js';


/**
 * Create a user
 * @param {Object} userBody
 * @returns {Promise<User>}
 */
const createUser = async (userBody) => {
  if (await User.isEmailTaken(userBody.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  
  // Set default navigation based on role if not provided
  if (!userBody.navigation) {
    userBody.navigation = getDefaultNavigationByRole(userBody.role || 'user');
  } else if (!validateNavigationStructure(userBody.navigation)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid navigation structure');
  }
  
  return User.create(userBody);
};

/**
 * Query for users
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryUsers = async (filter, options) => {
  const users = await User.paginate(filter, options);
  return users;
};

/**
 * Get user by id
 * @param {ObjectId} id
 * @returns {Promise<User>}
 */
const getUserById = async (id) => {
  return User.findById(id);
};

/**
 * Get user by email
 * @param {string} email
 * @returns {Promise<User>}
 */
const getUserByEmail = async (email) => {
  return User.findOne({ email });
};

/**
 * Update user by id
 * @param {ObjectId} userId
 * @param {Object} updateBody
 * @returns {Promise<User>}
 */
const updateUserById = async (userId, updateBody) => {
  const user = await getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  if (updateBody.email && (await User.isEmailTaken(updateBody.email, userId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  
  // Validate navigation structure if provided
  if (updateBody.navigation && !validateNavigationStructure(updateBody.navigation)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid navigation structure');
  }
  
  Object.assign(user, updateBody);
  await user.save();
  return user;
};

/**
 * Update user navigation permissions by id
 * @param {ObjectId} userId
 * @param {Object} navigationBody
 * @returns {Promise<User>}
 */
const updateUserNavigationById = async (userId, navigationBody) => {
  const user = await getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  
  // Validate navigation structure
  if (!validateNavigationStructure(navigationBody.navigation)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid navigation structure');
  }
  
  // Merge with existing navigation to preserve other permissions
  const updatedNavigation = mergeNavigation(user.navigation, navigationBody.navigation);
  
  Object.assign(user, { navigation: updatedNavigation });
  await user.save();
  return user;
};

/**
 * Delete user by id
 * @param {ObjectId} userId
 * @returns {Promise<User>}
 */
const deleteUserById = async (userId) => {
  const user = await getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  await user.remove();
  return user;
};

export {
  createUser,
  queryUsers,
  getUserById,
  getUserByEmail,
  updateUserById,
  updateUserNavigationById,
  deleteUserById,
};

