import mongoose from 'mongoose';
import validator from 'validator';
import bcrypt from 'bcryptjs';
import toJSON from './plugins/toJSON.plugin.js';
import paginate from './plugins/paginate.plugin.js';
import { roles } from '../config/roles.js';

const userSchema = mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true, // Automatically generates ObjectId for each user
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      validate(value) {
        if (!validator.isEmail(value)) {
          throw new Error('Invalid email');
        }
      },
    },
    password: {
      type: String,
      required: true,
      trim: true,
      minlength: 8,
      validate(value) {
        if (!value.match(/\d/) || !value.match(/[a-zA-Z]/)) {
          throw new Error('Password must contain at least one letter and one number');
        }
      },
      private: true,
    },
    phoneNumber: {
      type: String,
      trim: true,
    },
    profilePicture: {
      type: String,
      default: null,
    },
    dateOfBirth: {
      type: Date,
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other'],
      default: 'Other',
    },
    country: {
      type: String,
      trim: true,
    },
    timezone: {
      type: String,
      default: 'UTC',
    },
   
    role: {
      type: String,
      enum: roles,
      default: 'user',
    },
    navigation: {
      type: mongoose.Schema.Types.Mixed,
      default: {
        // Main Sidebar
        Dashboard: false,
        Catalog: {
          Items: false,
          Categories: false,
          'Raw Material': false,
          Processes: false,
          Attributes: false,
          'Style Codes': false,
          Machines: false,
          'Needle Configuration': false,
          'Team Master': false,
          'Containers Master': false
        },
        Sales: {
          'All Sales': false,
          'Master Sales': false
        },
        Stores: false,
        Analytics: false,
        'Replenishment Agent': false,
        'File Manager': false,
        Users: false,
        'Production Planning': {
          'Production Orders': false,
          'Knitting Floor': false,
          'Linking Floor': false,
          'Checking Floor': false,
          'Washing Floor': false,
          'Boarding Floor': false,
          'Silicon Floor': false,
          'Secondary Checking Floor': false,
          'Branding Floor': false,
          'Final Checking Floor': false,
          'Machine Floor': false,
          'Warehouse Floor': false
        },
        'Yarn Management': {
          'Dashboard': false,
          'Inventory': false,
          'Cataloguing': false,
          'Purchase Management':{
            'Requisition list': false,
            'Purchase Order': false,
            'Purchase Order Recevied': false,
            'Yarn QC': false,
            'Yarn Storage': false,
          },
          'Yarn Issue': false,
          'Yarn Return': false,
          'Yarn Master': {
            'Brand': false,
            'Yarn Type': false,
            'Count/Size': false,
            'Color': false,
            'Blend': false
          },

        },
        'Warehouse Management': {
          'Orders': false,
          'Pick&Pack': false,
          'Layout': false,
          'Stock': false,
          'Reports': false
        }
      }
    }
    
  },
  { timestamps: true }
);

// Add plugins for converting MongoDB document to JSON and pagination support
userSchema.plugin(toJSON);
userSchema.plugin(paginate);

/**
 * Check if email is taken
 * @param {string} email - The user's email
 * @param {ObjectId} [excludeUserId] - The id of the user to be excluded
 * @returns {Promise<boolean>}
 */
userSchema.statics.isEmailTaken = async function (email, excludeUserId) {
  const user = await this.findOne({ email, _id: { $ne: excludeUserId } });
  return !!user;
};

/**
 * Get user by email or username (name)
 * @param {string} emailOrUsername - The user's email or username (name)
 * @returns {Promise<User>}
 */
userSchema.statics.findByEmailOrUsername = async function (emailOrUsername) {
  return this.findOne({
    $or: [
      { email: emailOrUsername.toLowerCase() },
      { name: emailOrUsername }
    ]
  });
};

/**
 * Check if password matches the user's password
 * @param {string} password
 * @returns {Promise<boolean>}
 */
userSchema.methods.isPasswordMatch = async function (password) {
  const user = this;
  return bcrypt.compare(password, user.password);
};

// Hash password before saving
userSchema.pre('save', async function (next) {
  const user = this;
  if (user.isModified('password')) {
    user.password = await bcrypt.hash(user.password, 8);
  }
  next();
});

/**
 * @typedef User
 */
const User = mongoose.model('User', userSchema);

export default User;
