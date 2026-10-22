import httpStatus from 'http-status';

import ApiError from '../utils/ApiError.js';
import User from '../models/user.model.js';
import {
  DEFAULT_NAVIGATION,
  getDefaultNavigationByRole,
  mergeNavigation,
  validateNavigationStructure,
} from '../utils/navigationHelper.js';


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
 * Escape special regex chars for safe $regex use
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Query for users
 * @param {Object} filter - Mongo filter (name, role, search)
 * @param {Object} options - Query options
 * @returns {Promise<QueryResult>}
 */
const queryUsers = async (filter, options) => {
  const { search, name, role, ...rest } = filter;
  const mongoFilter = {};

  if (name) mongoFilter.name = { $regex: escapeRegex(name), $options: 'i' };
  if (role) mongoFilter.role = role;

  if (search?.trim()) {
    const term = escapeRegex(search.trim());
    mongoFilter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
    ];
  }

  const users = await User.paginate(mongoFilter, options);
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

const ADMIN_ROLES = ['admin', 'super_admin'];

/**
 * Admin and super_admin may change roles and navigation. Self-updates do not qualify.
 * @param {{ role?: string } | null | undefined} caller
 * @returns {boolean}
 */
const isAdminCaller = (caller) => ADMIN_ROLES.includes(caller?.role);

/**
 * Reject a role write unless the caller is admin or super_admin.
 * Password reset and email verification omit `role`, so they stay allowed.
 * @param {Object} updateBody
 * @param {{ role?: string } | null | undefined} caller
 */
const assertRoleChangeAllowed = (updateBody, caller) => {
  if (updateBody.role === undefined) {
    return;
  }
  if (!isAdminCaller(caller)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }
};

/**
 * Update user by id
 * @param {ObjectId} userId
 * @param {Object} updateBody
 * @param {{ role?: string } | null | undefined} [caller]
 * @returns {Promise<User>}
 */
const updateUserById = async (userId, updateBody, caller) => {
  const user = await getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  assertRoleChangeAllowed(updateBody, caller);
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
 * Update user navigation permissions by id.
 * Non-admins are rejected even when the target is themselves.
 * @param {ObjectId} userId
 * @param {Object} navigationBody
 * @param {{ role?: string } | null | undefined} caller
 * @returns {Promise<User>}
 */
const updateUserNavigationById = async (userId, navigationBody, caller) => {
  if (!isAdminCaller(caller)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }
  const user = await getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  
  // Merge stored navigation with incoming updates (do not re-apply role template — opt-in per user)
  const updatedNavigation = mergeNavigation(
    mergeNavigation(JSON.parse(JSON.stringify(DEFAULT_NAVIGATION)), user.navigation || {}),
    navigationBody.navigation
  );
  
  // Validate the merged navigation structure
  if (!validateNavigationStructure(updatedNavigation)) {
    // Log the issue for debugging
    console.error('Navigation validation failed for user:', userId);
    console.error('Merged navigation keys:', Object.keys(updatedNavigation));
    if (updatedNavigation['Yarn Management']) {
      console.error('Yarn Management keys:', Object.keys(updatedNavigation['Yarn Management']));
      if (updatedNavigation['Yarn Management']['Yarn Master']) {
        console.error('Yarn Master keys:', Object.keys(updatedNavigation['Yarn Management']['Yarn Master']));
      } else {
        console.error('Yarn Master is missing!');
      }
    }
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid navigation structure');
  }
  
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

