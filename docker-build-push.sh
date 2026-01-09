#!/bin/bash

# Docker Hub username (change this to your Docker Hub username)
DOCKER_USERNAME="${DOCKER_USERNAME:-your-username}"
IMAGE_NAME="${IMAGE_NAME:-addon-backend}"
VERSION="${VERSION:-latest}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Building Docker image...${NC}"

# Build the image
docker build -t ${DOCKER_USERNAME}/${IMAGE_NAME}:${VERSION} .

if [ $? -ne 0 ]; then
    echo -e "${RED}Build failed!${NC}"
    exit 1
fi

echo -e "${GREEN}Build successful!${NC}"

# Tag as latest if version is not latest
if [ "$VERSION" != "latest" ]; then
    echo -e "${YELLOW}Tagging as latest...${NC}"
    docker tag ${DOCKER_USERNAME}/${IMAGE_NAME}:${VERSION} ${DOCKER_USERNAME}/${IMAGE_NAME}:latest
fi

# Ask if user wants to push
read -p "Do you want to push to Docker Hub? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}Pushing to Docker Hub...${NC}"
    docker push ${DOCKER_USERNAME}/${IMAGE_NAME}:${VERSION}
    
    if [ "$VERSION" != "latest" ]; then
        docker push ${DOCKER_USERNAME}/${IMAGE_NAME}:latest
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Push successful!${NC}"
        echo -e "${GREEN}Image available at: docker.io/${DOCKER_USERNAME}/${IMAGE_NAME}:${VERSION}${NC}"
    else
        echo -e "${RED}Push failed! Make sure you're logged in to Docker Hub.${NC}"
        echo -e "${YELLOW}Run: docker login${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Skipping push. To push later, run:${NC}"
    echo -e "  docker push ${DOCKER_USERNAME}/${IMAGE_NAME}:${VERSION}"
fi
