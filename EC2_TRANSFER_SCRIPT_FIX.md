# Fix: Transfer Script Error on EC2

## Error
```
Error: Cannot find module '/home/ubuntu/AddOn_backend/src/scripts/transfer-atlas-to-local.js'
```

## Common Causes & Solutions

### 1. File Doesn't Exist on EC2

**Check if file exists:**
```bash
ls -la src/scripts/transfer-atlas-to-local.js
```

**If file doesn't exist:**
- The file wasn't synced to EC2
- Copy it from your local machine or pull from git

**Solution:**
```bash
# If using git
git pull origin main

# Or copy from local machine
scp src/scripts/transfer-atlas-to-local.js ubuntu@your-ec2-ip:~/AddOn_backend/src/scripts/
```

### 2. Missing `"type": "module"` in package.json

**Check package.json:**
```bash
cat package.json | grep "type"
```

**If missing, add it:**
```bash
# Edit package.json and add this line before the closing brace:
"type": "module"
```

**Or use sed:**
```bash
# Backup first
cp package.json package.json.backup

# Add type: module if missing
if ! grep -q '"type": "module"' package.json; then
    # Add it before the closing brace
    sed -i '$ s/}$/,\n  "type": "module"\n}/' package.json
fi
```

### 3. Wrong Working Directory

**Make sure you're in project root:**
```bash
# Check current directory
pwd
# Should be: /home/ubuntu/AddOn_backend

# If not, navigate there
cd ~/AddOn_backend
```

### 4. Node.js Version Issue

**Check Node version (needs 12+ for ES modules):**
```bash
node -v
# Should be v12.0.0 or higher
```

**If version is too old:**
```bash
# Update Node.js (using nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
```

### 5. Missing Dependencies

**Install dependencies:**
```bash
npm install
```

## Quick Fix Steps

Run these commands on your EC2 instance:

```bash
# 1. Navigate to project root
cd ~/AddOn_backend

# 2. Check if file exists
ls -la src/scripts/transfer-atlas-to-local.js

# 3. Check package.json has "type": "module"
grep "type" package.json

# 4. If missing, add it manually or:
cat package.json | tail -5
# Make sure it ends with:
#   },
#   "type": "module"
# }

# 5. Install dependencies
npm install

# 6. Check Node version
node -v

# 7. Try running again
node src/scripts/transfer-atlas-to-local.js --dry-run
```

## Manual Fix for package.json

If `"type": "module"` is missing, edit package.json:

```bash
nano package.json
```

Find the closing brace `}` and change:
```json
  }
}
```

To:
```json
  },
  "type": "module"
}
```

Save (Ctrl+X, Y, Enter)

## Verify Setup

```bash
# Run the check script (if you have it)
./check-script-setup.sh

# Or manually check:
echo "File exists: $(test -f src/scripts/transfer-atlas-to-local.js && echo 'YES' || echo 'NO')"
echo "Has type module: $(grep -q '"type": "module"' package.json && echo 'YES' || echo 'NO')"
echo "Node version: $(node -v)"
```

## Complete Setup Script

Run this on EC2 to fix everything:

```bash
#!/bin/bash
cd ~/AddOn_backend

# Check file exists
if [ ! -f "src/scripts/transfer-atlas-to-local.js" ]; then
    echo "❌ File not found! Pull from git or copy from local machine"
    exit 1
fi

# Check and fix package.json
if ! grep -q '"type": "module"' package.json; then
    echo "⚠️  Adding 'type: module' to package.json..."
    # Create backup
    cp package.json package.json.backup
    # Add type: module before closing brace
    sed -i '$ s/}$/,\n  "type": "module"\n}/' package.json
    echo "✓ Fixed package.json"
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Check Node version
echo "Node version: $(node -v)"

# Test run
echo "Testing script..."
node src/scripts/transfer-atlas-to-local.js --dry-run
```

## Environment Variables Needed

Make sure your `.env` file has:

```env
ATLAS_MONGODB_URL=mongodb+srv://username:password@cluster.mongodb.net
ATLAS_DB_NAME=Addonbackupdatabase
LOCAL_MONGODB_URL=mongodb://127.0.0.1:27017/addon
```

## Still Not Working?

1. **Check exact error:**
   ```bash
   node src/scripts/transfer-atlas-to-local.js --dry-run 2>&1
   ```

2. **Check file permissions:**
   ```bash
   ls -la src/scripts/transfer-atlas-to-local.js
   chmod +x src/scripts/transfer-atlas-to-local.js  # if needed
   ```

3. **Try with full path:**
   ```bash
   node /home/ubuntu/AddOn_backend/src/scripts/transfer-atlas-to-local.js --dry-run
   ```

4. **Check if it's a syntax error:**
   ```bash
   node --check src/scripts/transfer-atlas-to-local.js
   ```
