# Multi-Platform Docker Build Guide

## Problem Fixed

The error `no matching manifest for linux/amd64` occurred because images were built only for your Mac's architecture (ARM64). Now both images support:
- ✅ **linux/amd64** (Intel/Windows/Linux)
- ✅ **linux/arm64** (Apple Silicon/ARM)

## Quick Commands

### Rebuild Both Images (Multi-Platform)

**Backend:**
```bash
cd /Users/akshaypareek/Projects/Addon/backend/AddOn_backend
docker buildx build --platform linux/amd64,linux/arm64 \
  --tag akshaypareek/addon-backend:latest \
  --push \
  -f Dockerfile .
```

**Frontend:**
```bash
cd /Users/akshaypareek/Projects/Addon/frontend/Addon_frontend
docker buildx build --platform linux/amd64,linux/arm64 \
  --tag akshaypareek/addon-frontend:latest \
  --push \
  -f Dockerfile .
```

### Using the Script

```bash
# Build both
./docker-build-multiplatform.sh all

# Build only backend
./docker-build-multiplatform.sh backend

# Build only frontend
./docker-build-multiplatform.sh frontend
```

## Pulling on Different Devices

Now you can pull on **any device**:

```bash
# On Windows/Intel Linux
docker pull akshaypareek/addon-backend:latest
docker pull akshaypareek/addon-frontend:latest

# On Mac M1/M2 (ARM)
docker pull akshaypareek/addon-backend:latest
docker pull akshaypareek/addon-frontend:latest
```

Docker will automatically select the correct architecture!

## Verify Multi-Platform Support

```bash
# Check supported platforms
docker manifest inspect akshaypareek/addon-backend:latest | grep platform
docker manifest inspect akshaypareek/addon-frontend:latest | grep platform
```

You should see both `amd64` and `arm64` listed.

## What Changed

1. **Before:** Images built only for your Mac's architecture (ARM64)
2. **After:** Images built for both AMD64 and ARM64
3. **Result:** Works on Windows, Intel Macs, ARM Macs, and Linux

## Future Updates

Whenever you update code and need to rebuild:

1. **Use buildx** (not regular docker build):
   ```bash
   docker buildx build --platform linux/amd64,linux/arm64 --tag akshaypareek/addon-backend:latest --push .
   ```

2. **Or use the script:**
   ```bash
   ./docker-build-multiplatform.sh all
   ```

## Troubleshooting

### "buildx not found"
```bash
# Enable buildx (usually pre-installed in Docker Desktop)
docker buildx version
```

### "No such builder"
```bash
# Create multiplatform builder
docker buildx create --name multiplatform --use
```

### Still getting platform errors
```bash
# Make sure you're using buildx, not regular docker build
docker buildx build --platform linux/amd64,linux/arm64 ...
```

## Notes

- Multi-platform builds take longer (builds for both architectures)
- Images are larger in total size (but Docker only downloads the needed one)
- Always use `--push` with buildx to push the manifest list
