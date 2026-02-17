import mongoose from 'mongoose';
import { paginate } from '../plugins/index.js';
import { ProductionFloor, TeamRole, TeamMemberStatus } from './enums.js';

/**
 * Team Master Model
 * Stores team members with name, contact, floor, supervisor, role and status.
 */
const teamMasterSchema = new mongoose.Schema(
  {
    /** Full name of the team member */
    teamMemberName: {
      type: String,
      required: true,
      trim: true,
    },
    /** Contact number of the team member */
    contactNumber: {
      type: String,
      trim: true,
    },
    /** Floor where the member works */
    workingFloor: {
      type: String,
      required: true,
      enum: Object.values(ProductionFloor),
      index: true,
    },
    /** For supervisors: TeamMaster IDs of team members under this supervisor */
    myTeam: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'TeamMaster',
      default: [],
    },
    /** Role: Supervisor or Team Member */
    role: {
      type: String,
      required: true,
      enum: Object.values(TeamRole),
      default: TeamRole.TEAM_MEMBER,
      index: true,
    },
    /** Record status: Active or Inactive */
    status: {
      type: String,
      required: true,
      enum: Object.values(TeamMemberStatus),
      default: TeamMemberStatus.ACTIVE,
      index: true,
    },
    /** Barcode: stores _id (MongoDB id) for scan lookup; set automatically on create */
    barcode: {
      type: String,
      trim: true,
      unique: true,
      sparse: true, // allow null/absent for legacy docs
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'team_masters',
  }
);

// Set barcode to _id when doc is first created (so scan-by-barcode works)
teamMasterSchema.pre('save', function (next) {
  if (this.isNew && !this.barcode) {
    this.barcode = this._id ? this._id.toString() : null;
  }
  if (this.barcode === '' || this.barcode === null) this.barcode = this._id?.toString();
  next();
});

teamMasterSchema.index({ teamMemberName: 1, workingFloor: 1 });
teamMasterSchema.index({ status: 1, workingFloor: 1 });
teamMasterSchema.plugin(paginate);

export default mongoose.model('TeamMaster', teamMasterSchema);
