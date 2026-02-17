/**
 * Production System Enums
 * Core enums for the production management system
 */

// Order & Article Status
const OrderStatus = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold',
  CANCELLED: 'Cancelled'
};

// Yarn issue status (per production order item in machine assignment)
const YarnIssueStatus = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed'
};

// Priority Levels
const Priority = {
  URGENT: 'Urgent',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low'
};

// Linking Types
const LinkingType = {
  AUTO_LINKING: 'Auto Linking',
  ROSSO_LINKING: 'Rosso Linking',
  HAND_LINKING: 'Hand Linking'
};

// Production Floors
const ProductionFloor = {
  KNITTING: 'Knitting',
  LINKING: 'Linking',
  CHECKING: 'Checking',
  WASHING: 'Washing',
  BOARDING: 'Boarding',
  SILICON: 'Silicon',
  SECONDARY_CHECKING: 'Secondary Checking',
  BRANDING: 'Branding',
  FINAL_CHECKING: 'Final Checking',
  WAREHOUSE: 'Warehouse',
  DISPATCH: 'Dispatch'
};

// Quality Categories (Final Checking)
const QualityCategory = {
  M1: 'M1',
  M2: 'M2',
  M3: 'M3',
  M4: 'M4'
};

// Repair Status (Final Checking)
const RepairStatus = {
  NOT_REQUIRED: 'Not Required',
  IN_REVIEW: 'In Review',
  REPAIRED: 'Repaired',
  REJECTED: 'Rejected'
};

// Team Master – role of the person
const TeamRole = {
  SUPERVISOR: 'Supervisor',
  TEAM_MEMBER: 'Team Member'
};

// Team Master – record status
const TeamMemberStatus = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive'
};

// Containers Master – container status
const ContainerStatus = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive'
};

// Complete list of all loggable actions
const LogAction = {
  // Order Management
  ORDER_CREATED: 'Order Created',
  ORDER_UPDATED: 'Order Updated',
  ORDER_CANCELLED: 'Order Cancelled',
  ORDER_PUT_ON_HOLD: 'Order Put On Hold',
  ORDER_RESUMED: 'Order Resumed',
  ORDER_COMPLETED: 'Order Completed',
  
  // Article Management
  ARTICLE_ADDED: 'Article Added',
  ARTICLE_UPDATED: 'Article Updated',
  ARTICLE_REMOVED: 'Article Removed',
  ARTICLE_STATUS_CHANGED: 'Article Status Changed',
  ARTICLE_PRIORITY_CHANGED: 'Article Priority Changed',
  
  // Floor Operations
  WORK_STARTED: 'Work Started',
  WORK_PAUSED: 'Work Paused',
  WORK_RESUMED: 'Work Resumed',
  WORK_COMPLETED: 'Work Completed',
  QUANTITY_UPDATED: 'Quantity Updated',
  PROGRESS_UPDATED: 'Progress Updated',
  REMARKS_ADDED: 'Remarks Added',
  REMARKS_UPDATED: 'Remarks Updated',
  
  // Floor Transfers
  TRANSFERRED_TO_KNITTING: 'Transferred to Knitting',
  TRANSFERRED_TO_LINKING: 'Transferred to Linking',
  TRANSFERRED_TO_CHECKING: 'Transferred to Checking',
  TRANSFERRED_TO_WASHING: 'Transferred to Washing',
  TRANSFERRED_TO_BOARDING: 'Transferred to Boarding',
  TRANSFERRED_TO_SILICON: 'Transferred to Silicon',
  TRANSFERRED_TO_SECONDARY_CHECKING: 'Transferred to Secondary Checking',
  TRANSFERRED_TO_BRANDING: 'Transferred to Branding',
  TRANSFERRED_TO_FINAL_CHECKING: 'Transferred to Final Checking',
  TRANSFERRED_TO_WAREHOUSE: 'Transferred to Warehouse',
  TRANSFERRED_TO_DISPATCH: 'Transferred to Dispatch',
  
  // Quality Control
  QUALITY_CHECK_STARTED: 'Quality Check Started',
  QUALITY_CHECK_COMPLETED: 'Quality Check Completed',
  QUALITY_INSPECTION: 'Quality Inspection',
  M1_QUANTITY_UPDATED: 'M1 Quantity Updated',
  M2_QUANTITY_UPDATED: 'M2 Quantity Updated',
  M3_QUANTITY_UPDATED: 'M3 Quantity Updated',
  M4_QUANTITY_UPDATED: 'M4 Quantity Updated',
  M2_ITEM_SHIFTED_TO_M1: 'M2 Item Shifted to M1',
  M2_ITEM_SHIFTED_TO_M3: 'M2 Item Shifted to M3',
  M2_ITEM_SHIFTED_TO_M4: 'M2 Item Shifted to M4',
  REPAIR_STARTED: 'Repair Started',
  REPAIR_COMPLETED: 'Repair Completed',
  REPAIR_REJECTED: 'Repair Rejected',
  FINAL_QUALITY_CONFIRMED: 'Final Quality Confirmed',
  FINAL_QUALITY_REJECTED: 'Final Quality Rejected',
  
  // System Operations
  FLOOR_STATISTICS_UPDATED: 'Floor Statistics Updated',
  DASHBOARD_REFRESHED: 'Dashboard Refreshed',
  REPORT_GENERATED: 'Report Generated',
  EXPORT_INITIATED: 'Export Initiated',
  BACKUP_CREATED: 'Backup Created',
  
  // Error and Issues
  ERROR_OCCURRED: 'Error Occurred',
  ISSUE_REPORTED: 'Issue Reported',
  ISSUE_RESOLVED: 'Issue Resolved',
  MACHINE_BREAKDOWN: 'Machine Breakdown',
  MACHINE_REPAIRED: 'Machine Repaired',
  MATERIAL_SHORTAGE: 'Material Shortage',
  MATERIAL_RECEIVED: 'Material Received',
  
  // User Actions
  USER_LOGIN: 'User Login',
  USER_LOGOUT: 'User Logout',
  PERMISSION_CHANGED: 'Permission Changed',
  PASSWORD_CHANGED: 'Password Changed',
  PROFILE_UPDATED: 'Profile Updated',

  // Machine Order Assignment
  ASSIGNMENT_CREATED: 'Assignment Created',
  ASSIGNMENT_UPDATED: 'Assignment Updated',
  ASSIGNMENT_ACTIVE_NEEDLE_CHANGED: 'Active Needle Changed',
  ASSIGNMENT_ITEMS_UPDATED: 'Assignment Items Updated',
  ASSIGNMENT_ITEM_STATUS_CHANGED: 'Assignment Item Status Changed',
  ASSIGNMENT_ITEM_PRIORITY_CHANGED: 'Assignment Item Priority Changed',
  ASSIGNMENT_ITEM_COMPLETED_REMOVED: 'Assignment Item Completed And Removed',
  ASSIGNMENT_DEACTIVATED: 'Assignment Deactivated'
};

export {
  OrderStatus,
  YarnIssueStatus,
  Priority,
  LinkingType,
  ProductionFloor,
  QualityCategory,
  RepairStatus,
  LogAction,
  TeamRole,
  TeamMemberStatus,
  ContainerStatus
};
