# User Navigation Migration Guide

This guide explains how to migrate existing users to the new navigation structure after updating the backend navigation system.

## What Changed

The navigation structure has been updated to match the frontend:

### New Navigation Structure:
- **Added**: "Machines" to Catalog sub-menu
- **Renamed**: "Production" → "Production Planning"
- **Updated Floor Names**:
  - "Production Supervisor" → "Production Orders"
  - "Knitting Floor Supervisor" → "Knitting Floor"
  - "Linking Floor Supervisor" → "Linking Floor"
  - "Checking Floor Supervisor" → "Checking Floor"
  - "Washing Floor Supervisor" → "Washing Floor"
  - "Boarding Floor Supervisor" → "Boarding Floor"
  - "Final Checking Floor Supervisor" → "Final Checking Floor"
  - "Branding Floor Supervisor" → "Branding Floor"
  - "Warehouse Floor Supervisor" → "Warehouse Floor"

## Migration Scripts

### 1. Check Current Status
First, check which users need migration:

```bash
npm run check:navigation
```

This will show you:
- How many users have the new structure
- How many users have the old structure
- How many users have no navigation set

### 2. Update User Navigation
Run the migration to update all users:

```bash
npm run migrate:navigation
```

This will:
- Update all users to the new navigation structure
- Set appropriate permissions based on user role
- Skip users who already have the new structure

## Permission Structure

### Admin Users
Admins get access to all navigation items:
- Dashboard: ✅
- All Catalog items (including Machines): ✅
- All Sales items: ✅
- All individual links: ✅
- All Production Planning items: ✅

### Regular Users
Regular users get basic access:
- Dashboard: ✅
- Catalog Items: ✅
- Sales All Sales: ✅
- All other items: ❌ (can be enabled per user)

## Manual Migration (Alternative)

If you prefer to migrate users manually, you can use the API:

### Update User Navigation via API
```bash
PATCH /api/v1/users/{userId}/navigation
Content-Type: application/json

{
  "navigation": {
    "Dashboard": true,
    "Catalog": {
      "Items": true,
      "Categories": false,
      "Raw Material": false,
      "Processes": false,
      "Attributes": false,
      "Machines": false
    },
    "Sales": {
      "All Sales": true,
      "Master Sales": false
    },
    "Stores": false,
    "Analytics": false,
    "Replenishment Agent": false,
    "File Manager": false,
    "Users": false,
    "Production Planning": {
      "Production Orders": false,
      "Knitting Floor": false,
      "Linking Floor": false,
      "Checking Floor": false,
      "Washing Floor": false,
      "Boarding Floor": false,
      "Final Checking Floor": false,
      "Branding Floor": false,
      "Warehouse Floor": false
    }
  }
}
```

## Verification

After running the migration, verify the results:

```bash
npm run check:navigation
```

All users should now show "✅ New structure".

## Troubleshooting

### If Migration Fails
1. Check MongoDB connection
2. Ensure all dependencies are installed
3. Check user permissions in the database
4. Review error messages in the console

### If Users Still Have Old Structure
1. Run the check script again
2. Manually update any remaining users
3. Check for any custom navigation logic in your application

### Rollback (if needed)
If you need to rollback:
1. Restore from database backup
2. Or manually update users back to old structure
3. Update your models back to the old navigation structure

## Files Modified

The following files were updated for the new navigation structure:
- `src/models/user.model.js` - User model navigation schema
- `src/utils/navigationHelper.js` - Navigation helper functions
- `src/validations/user.validation.js` - Validation schemas
- `src/routes/v1/user.route.js` - API documentation

## Support

If you encounter any issues during migration, check:
1. Database connectivity
2. User permissions
3. Console error messages
4. Network connectivity

The migration scripts are designed to be safe and will not delete any existing data.
