#!/bin/bash

# Script to check and fix transfer script setup on EC2

echo "Checking script setup..."

# Check if file exists
if [ ! -f "src/scripts/transfer-atlas-to-local.js" ]; then
    echo "❌ Error: src/scripts/transfer-atlas-to-local.js not found!"
    echo "   Make sure you're in the project root directory"
    exit 1
fi

# Check package.json
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found!"
    exit 1
fi

# Check if type: module exists
if ! grep -q '"type": "module"' package.json; then
    echo "⚠️  Warning: package.json missing 'type: module'"
    echo "   Adding it now..."
    # This is a backup - user should fix manually
    echo "   Please add '\"type\": \"module\"' to package.json"
fi

# Check Node.js version
NODE_VERSION=$(node -v)
echo "✓ Node.js version: $NODE_VERSION"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found"
    echo "   You need to create .env with:"
    echo "   - ATLAS_MONGODB_URL"
    echo "   - LOCAL_MONGODB_URL (optional, defaults to mongodb://127.0.0.1:27017/addon)"
fi

echo ""
echo "To run the script:"
echo "  node src/scripts/transfer-atlas-to-local.js --dry-run"
