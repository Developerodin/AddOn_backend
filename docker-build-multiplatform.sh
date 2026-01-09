#!/bin/bash

# Multi-platform Docker Build Script
# Builds images for both ARM64 (Apple Silicon) and AMD64 (Intel/Windows)

DOCKER_USERNAME="${DOCKER_USERNAME:-akshaypareek}"
BACKEND_IMAGE="${DOCKER_USERNAME}/addon-backend"
FRONTEND_IMAGE="${DOCKER_USERNAME}/addon-frontend"
VERSION="${VERSION:-latest}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}Setting up multi-platform builder...${NC}"

# Create and use a multi-platform builder
docker buildx create --name multiplatform --use 2>/dev/null || docker buildx use multiplatform

echo -e "${GREEN}Building multi-platform images...${NC}"
echo -e "${YELLOW}This will build for: linux/amd64, linux/arm64${NC}"

# Build and push backend
if [ "$1" == "backend" ] || [ "$1" == "all" ] || [ -z "$1" ]; then
    echo -e "${GREEN}Building backend for multiple platforms...${NC}"
    docker buildx build \
        --platform linux/amd64,linux/arm64 \
        --tag ${BACKEND_IMAGE}:${VERSION} \
        --tag ${BACKEND_IMAGE}:latest \
        --push \
        -f Dockerfile \
        .
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Backend pushed successfully!${NC}"
    else
        echo -e "${RED}✗ Backend build failed!${NC}"
        exit 1
    fi
fi

# Build and push frontend (if Dockerfile exists in frontend directory)
if [ "$1" == "frontend" ] || [ "$1" == "all" ]; then
    if [ -f "../AddOn_frontend/Dockerfile" ]; then
        echo -e "${GREEN}Building frontend for multiple platforms...${NC}"
        cd ../AddOn_frontend
        docker buildx build \
            --platform linux/amd64,linux/arm64 \
            --tag ${FRONTEND_IMAGE}:${VERSION} \
            --tag ${FRONTEND_IMAGE}:latest \
            --push \
            -f Dockerfile \
            .
        cd - > /dev/null
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ Frontend pushed successfully!${NC}"
        else
            echo -e "${RED}✗ Frontend build failed!${NC}"
            exit 1
        fi
    else
        echo -e "${YELLOW}Frontend Dockerfile not found. Skipping frontend build.${NC}"
    fi
fi

echo -e "${GREEN}✓ All images built and pushed for multiple platforms!${NC}"
echo -e "${GREEN}Images are now available for both AMD64 and ARM64 architectures${NC}"
