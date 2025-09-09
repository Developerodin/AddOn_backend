import Joi from 'joi';
import { password, objectId } from './custom.validation.js';


const createUser = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    name: Joi.string().required(),
    role: Joi.string().required().valid('user', 'admin'),
    phoneNumber: Joi.string().allow(''),
    profilePicture: Joi.string().allow(''),
    dateOfBirth: Joi.date(),
    gender: Joi.string().valid('Male', 'Female', 'Other'),
    country: Joi.string().allow(''),
    timezone: Joi.string().default('UTC'),
    navigation: Joi.object().keys({
      Users: Joi.boolean(),
      Dashboard: Joi.boolean(),
      Catalog: Joi.object().keys({
        Items: Joi.boolean(),
        Categories: Joi.boolean(),
        'Raw Material': Joi.boolean(),
        Processes: Joi.boolean(),
        Attributes: Joi.boolean()
      }),
      Sales: Joi.object().keys({
        'All Sales': Joi.boolean(),
        'Master Sales': Joi.boolean()
      }),
      Stores: Joi.boolean(),
      Analytics: Joi.boolean(),
      'Replenishment Agent': Joi.boolean(),
      'File Manager': Joi.boolean(),
      Production: Joi.object().keys({
        'Production Supervisor': Joi.boolean(),
        'Knitting Floor Supervisor': Joi.boolean(),
        'Linking Floor Supervisor': Joi.boolean(),
        'Checking Floor Supervisor': Joi.boolean(),
        'Washing Floor Supervisor': Joi.boolean(),
        'Boarding Floor Supervisor': Joi.boolean(),
        'Final Checking Floor Supervisor': Joi.boolean(),
        'Branding Floor Supervisor': Joi.boolean(),
        'Warehouse Floor Supervisor': Joi.boolean()
      })
    }).optional(),
  }),
};

const getUsers = {
  query: Joi.object().keys({
    name: Joi.string(),
    role: Joi.string(),
    sortBy: Joi.string(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getUser = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId),
  }),
};

const updateUser = {
  params: Joi.object().keys({
    userId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      email: Joi.string().email(),
      password: Joi.string().custom(password),
      name: Joi.string(),
      phoneNumber: Joi.string().allow(''),
      profilePicture: Joi.string().allow(''),
      dateOfBirth: Joi.date(),
      gender: Joi.string().valid('Male', 'Female', 'Other'),
      country: Joi.string().allow(''),
      timezone: Joi.string(),
      role: Joi.string().valid('user', 'admin'),
      navigation: Joi.object().keys({
        Users: Joi.boolean(),
        Dashboard: Joi.boolean(),
        Catalog: Joi.object().keys({
          Items: Joi.boolean(),
          Categories: Joi.boolean(),
          'Raw Material': Joi.boolean(),
          Processes: Joi.boolean(),
          Attributes: Joi.boolean()
        }),
        Sales: Joi.object().keys({
          'All Sales': Joi.boolean(),
          'Master Sales': Joi.boolean()
        }),
        Stores: Joi.boolean(),
        Analytics: Joi.boolean(),
        'Replenishment Agent': Joi.boolean(),
        'File Manager': Joi.boolean(),
        Production: Joi.object().keys({
          'Production Supervisor': Joi.boolean(),
          'Knitting Floor Supervisor': Joi.boolean(),
          'Linking Floor Supervisor': Joi.boolean(),
          'Checking Floor Supervisor': Joi.boolean(),
          'Washing Floor Supervisor': Joi.boolean(),
          'Boarding Floor Supervisor': Joi.boolean(),
          'Final Checking Floor Supervisor': Joi.boolean(),
          'Branding Floor Supervisor': Joi.boolean(),
          'Warehouse Floor Supervisor': Joi.boolean()
        })
      }),
    })
    .min(1),
};

const updateUserNavigation = {
  params: Joi.object().keys({
    userId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      navigation: Joi.object().keys({
        Users: Joi.boolean(),
        Dashboard: Joi.boolean(),
        Catalog: Joi.object().keys({
          Items: Joi.boolean(),
          Categories: Joi.boolean(),
          'Raw Material': Joi.boolean(),
          Processes: Joi.boolean(),
          Attributes: Joi.boolean()
        }),
        Sales: Joi.object().keys({
          'All Sales': Joi.boolean(),
          'Master Sales': Joi.boolean()
        }),
        Stores: Joi.boolean(),
        Analytics: Joi.boolean(),
        'Replenishment Agent': Joi.boolean(),
        'File Manager': Joi.boolean(),
        Production: Joi.object().keys({
          'Production Supervisor': Joi.boolean(),
          'Knitting Floor Supervisor': Joi.boolean(),
          'Linking Floor Supervisor': Joi.boolean(),
          'Checking Floor Supervisor': Joi.boolean(),
          'Washing Floor Supervisor': Joi.boolean(),
          'Boarding Floor Supervisor': Joi.boolean(),
          'Final Checking Floor Supervisor': Joi.boolean(),
          'Branding Floor Supervisor': Joi.boolean(),
          'Warehouse Floor Supervisor': Joi.boolean()
        })
      }).required(),
    })
    .min(1),
};

const deleteUser = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId),
  }),
};

export { createUser, getUsers, getUser, updateUser, updateUserNavigation, deleteUser };

