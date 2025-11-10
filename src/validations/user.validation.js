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
      Dashboard: Joi.boolean(),
      Catalog: Joi.object().keys({
        Items: Joi.boolean(),
        Categories: Joi.boolean(),
        'Raw Material': Joi.boolean(),
        Processes: Joi.boolean(),
        Attributes: Joi.boolean(),
        Machines: Joi.boolean()
      }),
      Sales: Joi.object().keys({
        'All Sales': Joi.boolean(),
        'Master Sales': Joi.boolean()
      }),
      Stores: Joi.boolean(),
      Analytics: Joi.boolean(),
      'Replenishment Agent': Joi.boolean(),
      'File Manager': Joi.boolean(),
      Users: Joi.boolean(),
      'Production Planning': Joi.object().keys({
        'Production Orders': Joi.boolean(),
        'Knitting Floor': Joi.boolean(),
        'Linking Floor': Joi.boolean(),
        'Checking Floor': Joi.boolean(),
        'Washing Floor': Joi.boolean(),
        'Boarding Floor': Joi.boolean(),
        'Final Checking Floor': Joi.boolean(),
        'Branding Floor': Joi.boolean(),
        'Machine Floor': Joi.boolean(),
        'Warehouse Floor': Joi.boolean()
      }),
      'Yarn Management': Joi.object().keys({
        'Cataloguing': Joi.boolean(),
        'Purchase': Joi.boolean(),
        'Inventory': Joi.boolean(),
        'Yarn Issue': Joi.boolean(),
        'Yarn Master': Joi.object().keys({
          'Brand': Joi.boolean(),
          'Yarn Type': Joi.boolean(),
          'Count/Size': Joi.boolean(),
          'Color': Joi.boolean()
        })
      }),
      'Warehouse Management': Joi.object().keys({
        'Orders': Joi.boolean(),
        'Pick&Pack': Joi.boolean(),
        'Layout': Joi.boolean(),
        'Stock': Joi.boolean(),
        'Reports': Joi.boolean()
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
        Dashboard: Joi.boolean(),
        Catalog: Joi.object().keys({
          Items: Joi.boolean(),
          Categories: Joi.boolean(),
          'Raw Material': Joi.boolean(),
          Processes: Joi.boolean(),
          Attributes: Joi.boolean(),
          Machines: Joi.boolean()
        }),
        Sales: Joi.object().keys({
          'All Sales': Joi.boolean(),
          'Master Sales': Joi.boolean()
        }),
        Stores: Joi.boolean(),
        Analytics: Joi.boolean(),
        'Replenishment Agent': Joi.boolean(),
        'File Manager': Joi.boolean(),
        Users: Joi.boolean(),
        'Production Planning': Joi.object().keys({
          'Production Orders': Joi.boolean(),
          'Knitting Floor': Joi.boolean(),
          'Linking Floor': Joi.boolean(),
          'Checking Floor': Joi.boolean(),
          'Washing Floor': Joi.boolean(),
          'Boarding Floor': Joi.boolean(),
          'Final Checking Floor': Joi.boolean(),
          'Branding Floor': Joi.boolean(),
          'Machine Floor': Joi.boolean(),
          'Warehouse Floor': Joi.boolean()
        }),
        'Yarn Management': Joi.object().keys({
          'Cataloguing': Joi.boolean(),
          'Purchase': Joi.boolean(),
          'Inventory': Joi.boolean(),
          'Yarn Issue': Joi.boolean(),
          'Yarn Master': Joi.object().keys({
            'Brand': Joi.boolean(),
            'Yarn Type': Joi.boolean(),
            'Count/Size': Joi.boolean(),
            'Color': Joi.boolean()
          })
        }),
        'Warehouse Management': Joi.object().keys({
          'Orders': Joi.boolean(),
          'Pick&Pack': Joi.boolean(),
          'Layout': Joi.boolean(),
          'Stock': Joi.boolean(),
          'Reports': Joi.boolean()
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
        Dashboard: Joi.boolean(),
        Catalog: Joi.object().keys({
          Items: Joi.boolean(),
          Categories: Joi.boolean(),
          'Raw Material': Joi.boolean(),
          Processes: Joi.boolean(),
          Attributes: Joi.boolean(),
          Machines: Joi.boolean()
        }).unknown(true),
        Sales: Joi.object().keys({
          'All Sales': Joi.boolean(),
          'Master Sales': Joi.boolean()
        }).unknown(true),
        Stores: Joi.boolean(),
        Analytics: Joi.boolean(),
        'Replenishment Agent': Joi.boolean(),
        'File Manager': Joi.boolean(),
        Users: Joi.boolean(),
        'Production Planning': Joi.object().keys({
          'Production Orders': Joi.boolean(),
          'Knitting Floor': Joi.boolean(),
          'Linking Floor': Joi.boolean(),
          'Checking Floor': Joi.boolean(),
          'Washing Floor': Joi.boolean(),
          'Boarding Floor': Joi.boolean(),
          'Final Checking Floor': Joi.boolean(),
          'Branding Floor': Joi.boolean(),
          'Machine Floor': Joi.boolean(),
          'Warehouse Floor': Joi.boolean()
        }).unknown(true),
        'Yarn Management': Joi.object().keys({
          'Cataloguing': Joi.boolean(),
          'Purchase': Joi.boolean(),
          'Inventory': Joi.boolean(),
          'Yarn Issue': Joi.boolean(),
          'Yarn Master': Joi.object().keys({
            'Brand': Joi.boolean(),
            'Yarn Type': Joi.boolean(),
            'Count/Size': Joi.boolean(),
            'Color': Joi.boolean()
          }).unknown(true)
        }).unknown(true),
        'Warehouse Management': Joi.object().keys({
          'Orders': Joi.boolean(),
          'Pick&Pack': Joi.boolean(),
          'Layout': Joi.boolean(),
          'Stock': Joi.boolean(),
          'Reports': Joi.boolean()
        }).unknown(true)
      }).unknown(true).required(),
    })
    .min(1),
};

const deleteUser = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId),
  }),
};

export { createUser, getUsers, getUser, updateUser, updateUserNavigation, deleteUser };

