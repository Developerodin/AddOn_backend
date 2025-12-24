# Production Database Migration Guide

This guide outlines the scripts to run on the production database to migrate product data to the new format.

## Migration Steps (Run in Order)

### Step 1: Transform Products to New Format
**Script:** `migrate-product-stylecodes.js`

**What it does:**
- Converts individual `styleCode` and `eanCode` fields → `styleCodes` array
- Sets `mrp` to `0` by default if missing
- Removes old `styleCode` and `eanCode` fields

**Command:**
```bash
NODE_ENV=production node migrate-product-stylecodes.js
```

**Expected output:**
- Updates all products with old format
- Sets mrp to 0 for missing values
- Verification shows all products in new format

---

### Step 2: Remove Duplicate StyleCodes
**Script:** `fix-duplicate-stylecodes.js`

**What it does:**
- Removes duplicate `styleCodes` entries within each product
- Duplicates are identified by matching `styleCode` + `eanCode` combination
- Keeps only the first occurrence

**Command:**
```bash
NODE_ENV=production node fix-duplicate-stylecodes.js
```

**Expected output:**
- Removes duplicate styleCodes from products
- Verification shows no duplicates remaining

---

### Step 3: Merge Duplicate Products by Factory Code
**Script:** `merge-duplicate-products-by-factory-code.js`

**What it does:**
- Finds products with the same `factoryCode`
- Merges them into a single product
- Combines all `styleCodes` from duplicates
- Removes duplicate styleCodes after merge
- Cleans product names (removes first 2 characters)
- Deletes duplicate products

**Command:**
```bash
NODE_ENV=production node merge-duplicate-products-by-factory-code.js
```

**Expected output:**
- Merges products with duplicate factory codes
- Combines styleCodes arrays
- Deletes duplicate product entries

---

### Step 4: Clean Product Names
**Script:** `clean-product-names.js`

**What it does:**
- Removes first 2 characters from all product names
- Example: "AS Mens white" → "Mens white"
- Example: "VM Mens white" → "Mens white"

**Command:**
```bash
NODE_ENV=production node clean-product-names.js
```

**Expected output:**
- Updates all product names
- Verification shows no 2-letter prefixes remaining

---

## Quick Run All Scripts

You can create a master script or run them sequentially:

```bash
# Set production environment
export NODE_ENV=production

# Step 1: Transform to new format
node migrate-product-stylecodes.js

# Step 2: Remove duplicate styleCodes
node fix-duplicate-stylecodes.js

# Step 3: Merge duplicate products
node merge-duplicate-products-by-factory-code.js

# Step 4: Clean product names
node clean-product-names.js
```

---

## Important Notes

1. **Backup First:** Always backup your production database before running migrations
2. **Test Environment:** If possible, test these scripts on a staging environment first
3. **NODE_ENV:** Make sure `NODE_ENV=production` is set to connect to production database
4. **Monitor:** Watch the output of each script to ensure successful completion
5. **Verification:** Each script includes verification steps - review them carefully

---

## Verification Checklist

After running all scripts, verify:

- [ ] All products have `styleCodes` array (not individual `styleCode`/`eanCode` fields)
- [ ] No duplicate `styleCodes` within products
- [ ] No duplicate products with same `factoryCode`
- [ ] Product names don't start with 2-letter prefixes (AS, VM, etc.)
- [ ] All `styleCodes` have valid `mrp` values (default 0 if missing)

---

## Rollback

If you need to rollback, you'll need to restore from your database backup. These migrations modify data structure, so rollback requires restoring the backup.

---

## Script Files

All scripts are located in the project root:
- `migrate-product-stylecodes.js`
- `fix-duplicate-stylecodes.js`
- `merge-duplicate-products-by-factory-code.js`
- `clean-product-names.js`

