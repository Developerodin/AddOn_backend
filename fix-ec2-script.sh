#!/bin/bash

# Quick fix script for EC2 transfer script issue

echo "🔧 Fixing transfer script setup on EC2..."

cd ~/AddOn_backend || {
    echo "❌ Error: ~/AddOn_backend directory not found!"
    exit 1
}

# 1. Check if file exists
if [ ! -f "src/scripts/transfer-atlas-to-local.js" ]; then
    echo "❌ Error: src/scripts/transfer-atlas-to-local.js not found!"
    echo "   Please ensure the file exists or pull from git:"
    echo "   git pull origin main"
    exit 1
fi
echo "✓ File exists"

# 2. Check package.json
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found!"
    exit 1
fi

# 3. Check and fix "type": "module"
if ! grep -q '"type": "module"' package.json; then
    echo "⚠️  Adding 'type: module' to package.json..."
    cp package.json package.json.backup
    
    # Remove last closing brace, add type: module, then close
    head -n -1 package.json > package.json.tmp
    echo '  "type": "module"' >> package.json.tmp
    echo '}' >> package.json.tmp
    mv package.json.tmp package.json
    
    echo "✓ Fixed package.json"
else
    echo "✓ package.json already has 'type: module'"
fi

# 4. Check Node version
NODE_VERSION=$(node -v 2>/dev/null)
if [ -z "$NODE_VERSION" ]; then
    echo "❌ Error: Node.js not found!"
    exit 1
fi
echo "✓ Node.js version: $NODE_VERSION"

# 5. Install dependencies
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
else
    echo "✓ Dependencies already installed"
fi

# 6. Check .env
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found"
    echo "   Create .env with:"
    echo "   - ATLAS_MONGODB_URL"
    echo "   - LOCAL_MONGODB_URL (optional)"
fi

echo ""
echo "✅ Setup complete! Try running:"
echo "   node src/scripts/transfer-atlas-to-local.js --dry-run"
