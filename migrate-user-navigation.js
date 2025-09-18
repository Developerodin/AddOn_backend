/**
 * Migration Script: Update User Navigation Structure
 * 
 * This script migrates existing users to the new navigation structure:
 * - Adds "Machines" to Catalog sub-menu
 * - Renames "Production" to "Production Planning"
 * - Updates floor supervisor names
 * - Reorders navigation items to match frontend
 */

import mongoose from 'mongoose';
import User from './src/models/user.model.js';
import { getDefaultNavigationByRole, mergeNavigation } from './src/utils/navigationHelper.js';
import config from './src/config/config.js';

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// New navigation structure mapping
const NEW_NAVIGATION_STRUCTURE = {
  Dashboard: false,
  Catalog: {
    Items: false,
    Categories: false,
    'Raw Material': false,
    Processes: false,
    Attributes: false,
    Machines: false
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
    'Final Checking Floor': false,
    'Branding Floor': false,
    'Warehouse Floor': false
  }
};

// Mapping from old navigation to new navigation
const NAVIGATION_MAPPING = {
  // Direct mappings
  'Users': 'Users',
  'Dashboard': 'Dashboard',
  'Stores': 'Stores',
  'Analytics': 'Analytics',
  'Replenishment Agent': 'Replenishment Agent',
  'File Manager': 'File Manager',
  
  // Catalog mappings
  'Catalog.Items': 'Catalog.Items',
  'Catalog.Categories': 'Catalog.Categories',
  'Catalog.Raw Material': 'Catalog.Raw Material',
  'Catalog.Processes': 'Catalog.Processes',
  'Catalog.Attributes': 'Catalog.Attributes',
  'Catalog.Machines': 'Catalog.Machines', // New field
  
  // Sales mappings
  'Sales.All Sales': 'Sales.All Sales',
  'Sales.Master Sales': 'Sales.Master Sales',
  
  // Production mappings (old -> new)
  'Production.Production Supervisor': 'Production Planning.Production Orders',
  'Production.Knitting Floor Supervisor': 'Production Planning.Knitting Floor',
  'Production.Linking Floor Supervisor': 'Production Planning.Linking Floor',
  'Production.Checking Floor Supervisor': 'Production Planning.Checking Floor',
  'Production.Washing Floor Supervisor': 'Production Planning.Washing Floor',
  'Production.Boarding Floor Supervisor': 'Production Planning.Boarding Floor',
  'Production.Final Checking Floor Supervisor': 'Production Planning.Final Checking Floor',
  'Production.Branding Floor Supervisor': 'Production Planning.Branding Floor',
  'Production.Warehouse Floor Supervisor': 'Production Planning.Warehouse Floor'
};

/**
 * Migrate a single user's navigation
 * @param {Object} user - User document
 * @returns {Object} Updated navigation object
 */
const migrateUserNavigation = (user) => {
  const oldNavigation = user.navigation || {};
  const newNavigation = JSON.parse(JSON.stringify(NEW_NAVIGATION_STRUCTURE)); // Deep clone
  
  // Helper function to get nested value
  const getNestedValue = (obj, path) => {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  };
  
  // Helper function to set nested value
  const setNestedValue = (obj, path, value) => {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[keys[keys.length - 1]] = value;
  };
  
  // Migrate each old navigation item to new structure
  for (const [oldPath, newPath] of Object.entries(NAVIGATION_MAPPING)) {
    const oldValue = getNestedValue(oldNavigation, oldPath);
    if (oldValue !== undefined) {
      setNestedValue(newNavigation, newPath, oldValue);
    }
  }
  
  // Set default permissions based on role for new fields
  if (user.role === 'admin') {
    // Admins get access to everything
    newNavigation.Dashboard = true;
    newNavigation.Catalog.Items = true;
    newNavigation.Catalog.Categories = true;
    newNavigation.Catalog['Raw Material'] = true;
    newNavigation.Catalog.Processes = true;
    newNavigation.Catalog.Attributes = true;
    newNavigation.Catalog.Machines = true;
    newNavigation.Sales['All Sales'] = true;
    newNavigation.Sales['Master Sales'] = true;
    newNavigation.Stores = true;
    newNavigation.Analytics = true;
    newNavigation['Replenishment Agent'] = true;
    newNavigation['File Manager'] = true;
    newNavigation.Users = true;
    newNavigation['Production Planning']['Production Orders'] = true;
    newNavigation['Production Planning']['Knitting Floor'] = true;
    newNavigation['Production Planning']['Linking Floor'] = true;
    newNavigation['Production Planning']['Checking Floor'] = true;
    newNavigation['Production Planning']['Washing Floor'] = true;
    newNavigation['Production Planning']['Boarding Floor'] = true;
    newNavigation['Production Planning']['Final Checking Floor'] = true;
    newNavigation['Production Planning']['Branding Floor'] = true;
    newNavigation['Production Planning']['Warehouse Floor'] = true;
  } else {
    // Regular users get basic access
    newNavigation.Dashboard = true;
    newNavigation.Catalog.Items = true;
    newNavigation.Sales['All Sales'] = true;
    // All other permissions remain false by default
  }
  
  return newNavigation;
};

/**
 * Main migration function
 */
const migrateUsers = async () => {
  try {
    console.log('🚀 Starting user navigation migration...');
    
    // Get all users
    const users = await User.find({});
    console.log(`📊 Found ${users.length} users to migrate`);
    
    if (users.length === 0) {
      console.log('ℹ️  No users found. Migration complete.');
      return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const user of users) {
      try {
        console.log(`\n👤 Migrating user: ${user.name} (${user.email})`);
        
        // Migrate navigation
        const newNavigation = migrateUserNavigation(user);
        
        // Update user
        await User.findByIdAndUpdate(
          user._id,
          { navigation: newNavigation },
          { new: true }
        );
        
        console.log(`✅ Successfully migrated user: ${user.name}`);
        successCount++;
        
      } catch (error) {
        console.error(`❌ Error migrating user ${user.name}:`, error.message);
        errorCount++;
      }
    }
    
    console.log('\n📈 Migration Summary:');
    console.log(`✅ Successfully migrated: ${successCount} users`);
    console.log(`❌ Failed migrations: ${errorCount} users`);
    console.log(`📊 Total users processed: ${users.length}`);
    
    if (errorCount === 0) {
      console.log('\n🎉 All users migrated successfully!');
    } else {
      console.log('\n⚠️  Some users failed to migrate. Check the errors above.');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
};

/**
 * Verify migration results
 */
const verifyMigration = async () => {
  try {
    console.log('\n🔍 Verifying migration results...');
    
    const users = await User.find({});
    let validUsers = 0;
    let invalidUsers = 0;
    
    for (const user of users) {
      const nav = user.navigation;
      
      // Check if new structure exists
      const hasNewStructure = nav && 
        nav['Production Planning'] && 
        nav.Catalog && 
        nav.Catalog.Machines !== undefined;
      
      if (hasNewStructure) {
        validUsers++;
      } else {
        console.log(`⚠️  User ${user.name} still has old navigation structure`);
        invalidUsers++;
      }
    }
    
    console.log(`✅ Users with new structure: ${validUsers}`);
    console.log(`❌ Users with old structure: ${invalidUsers}`);
    
    if (invalidUsers === 0) {
      console.log('🎉 All users have been successfully migrated!');
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    
    // Ask for confirmation
    console.log('\n⚠️  WARNING: This will update navigation for ALL existing users!');
    console.log('This action cannot be undone. Make sure you have a database backup.');
    
    // In a real scenario, you might want to add a confirmation prompt here
    // For now, we'll proceed with the migration
    
    await migrateUsers();
    await verifyMigration();
    
  } catch (error) {
    console.error('❌ Migration script failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the migration
main();
