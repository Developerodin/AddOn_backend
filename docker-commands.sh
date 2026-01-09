#!/bin/bash

# Docker Commands Helper Script for Addon Backend
# Usage: ./docker-commands.sh [command]

DOCKER_USERNAME="${DOCKER_USERNAME:-your-username}"
IMAGE_NAME="addon-backend"
CONTAINER_NAME="addon-backend"
VERSION="${VERSION:-latest}"
FULL_IMAGE_NAME="${DOCKER_USERNAME}/${IMAGE_NAME}:${VERSION}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

show_help() {
    echo -e "${BLUE}Addon Backend Docker Commands${NC}"
    echo ""
    echo "Usage: ./docker-commands.sh [command]"
    echo ""
    echo "Commands:"
    echo "  build          - Build the Docker image locally"
    echo "  rebuild        - Rebuild the Docker image (no cache)"
    echo "  run            - Run the container using docker-compose"
    echo "  run-local      - Run container directly (not using compose)"
    echo "  stop           - Stop the running container"
    echo "  start          - Start the stopped container"
    echo "  restart        - Restart the container"
    echo "  logs           - View container logs"
    echo "  logs-follow    - Follow container logs (live)"
    echo "  shell          - Open shell in running container"
    echo "  push           - Push image to Docker Hub"
    echo "  pull           - Pull image from Docker Hub"
    echo "  remove         - Remove container and image"
    echo "  status         - Show container status"
    echo "  clean          - Clean up stopped containers and unused images"
    echo "  help           - Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  DOCKER_USERNAME - Your Docker Hub username (default: your-username)"
    echo "  VERSION         - Image version/tag (default: latest)"
    echo ""
    echo "Examples:"
    echo "  DOCKER_USERNAME=myuser ./docker-commands.sh build"
    echo "  DOCKER_USERNAME=myuser ./docker-commands.sh push"
    echo "  ./docker-commands.sh run"
    echo "  ./docker-commands.sh logs-follow"
}

build_image() {
    echo -e "${GREEN}Building Docker image...${NC}"
    docker build -t ${FULL_IMAGE_NAME} .
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Build successful!${NC}"
        docker tag ${FULL_IMAGE_NAME} ${DOCKER_USERNAME}/${IMAGE_NAME}:latest
    else
        echo -e "${RED}✗ Build failed!${NC}"
        exit 1
    fi
}

rebuild_image() {
    echo -e "${GREEN}Rebuilding Docker image (no cache)...${NC}"
    docker build --no-cache -t ${FULL_IMAGE_NAME} .
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Rebuild successful!${NC}"
        docker tag ${FULL_IMAGE_NAME} ${DOCKER_USERNAME}/${IMAGE_NAME}:latest
    else
        echo -e "${RED}✗ Rebuild failed!${NC}"
        exit 1
    fi
}

run_compose() {
    echo -e "${GREEN}Starting container with docker-compose...${NC}"
    if [ ! -f .env ]; then
        echo -e "${YELLOW}Warning: .env file not found. Make sure to create it!${NC}"
    fi
    DOCKER_USERNAME=${DOCKER_USERNAME} VERSION=${VERSION} docker-compose up -d
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Container started!${NC}"
        echo -e "${BLUE}View logs: ./docker-commands.sh logs${NC}"
    else
        echo -e "${RED}✗ Failed to start container!${NC}"
        exit 1
    fi
}

run_local() {
    echo -e "${GREEN}Starting container directly...${NC}"
    if [ ! -f .env ]; then
        echo -e "${YELLOW}Warning: .env file not found. Make sure to create it!${NC}"
    fi
    docker run -d \
        --name ${CONTAINER_NAME} \
        --restart unless-stopped \
        -p 3000:3000 \
        --env-file .env \
        ${FULL_IMAGE_NAME}
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Container started!${NC}"
    else
        echo -e "${RED}✗ Failed to start container!${NC}"
        exit 1
    fi
}

stop_container() {
    echo -e "${YELLOW}Stopping container...${NC}"
    docker-compose down 2>/dev/null || docker stop ${CONTAINER_NAME}
    echo -e "${GREEN}✓ Container stopped${NC}"
}

start_container() {
    echo -e "${GREEN}Starting container...${NC}"
    docker-compose up -d 2>/dev/null || docker start ${CONTAINER_NAME}
    echo -e "${GREEN}✓ Container started${NC}"
}

restart_container() {
    echo -e "${YELLOW}Restarting container...${NC}"
    docker-compose restart 2>/dev/null || docker restart ${CONTAINER_NAME}
    echo -e "${GREEN}✓ Container restarted${NC}"
}

view_logs() {
    echo -e "${BLUE}Container logs:${NC}"
    docker-compose logs ${CONTAINER_NAME} 2>/dev/null || docker logs ${CONTAINER_NAME}
}

follow_logs() {
    echo -e "${BLUE}Following container logs (Ctrl+C to exit):${NC}"
    docker-compose logs -f ${CONTAINER_NAME} 2>/dev/null || docker logs -f ${CONTAINER_NAME}
}

open_shell() {
    echo -e "${GREEN}Opening shell in container...${NC}"
    docker exec -it ${CONTAINER_NAME} /bin/sh
}

push_image() {
    echo -e "${GREEN}Pushing image to Docker Hub...${NC}"
    docker push ${FULL_IMAGE_NAME}
    if [ "$VERSION" != "latest" ]; then
        docker push ${DOCKER_USERNAME}/${IMAGE_NAME}:latest
    fi
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Push successful!${NC}"
        echo -e "${BLUE}Image available at: docker.io/${FULL_IMAGE_NAME}${NC}"
    else
        echo -e "${RED}✗ Push failed! Make sure you're logged in: docker login${NC}"
        exit 1
    fi
}

pull_image() {
    echo -e "${GREEN}Pulling image from Docker Hub...${NC}"
    docker pull ${FULL_IMAGE_NAME}
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Pull successful!${NC}"
    else
        echo -e "${RED}✗ Pull failed!${NC}"
        exit 1
    fi
}

remove_container() {
    echo -e "${YELLOW}Removing container and image...${NC}"
    read -p "Are you sure? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker-compose down 2>/dev/null
        docker stop ${CONTAINER_NAME} 2>/dev/null
        docker rm ${CONTAINER_NAME} 2>/dev/null
        docker rmi ${FULL_IMAGE_NAME} 2>/dev/null
        echo -e "${GREEN}✓ Removed${NC}"
    else
        echo -e "${YELLOW}Cancelled${NC}"
    fi
}

show_status() {
    echo -e "${BLUE}Container Status:${NC}"
    docker ps -a --filter "name=${CONTAINER_NAME}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    echo -e "${BLUE}Image Info:${NC}"
    docker images ${DOCKER_USERNAME}/${IMAGE_NAME} --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"
}

clean_docker() {
    echo -e "${YELLOW}Cleaning up Docker...${NC}"
    docker system prune -f
    echo -e "${GREEN}✓ Cleanup complete${NC}"
}

# Main command handler
case "$1" in
    build)
        build_image
        ;;
    rebuild)
        rebuild_image
        ;;
    run)
        run_compose
        ;;
    run-local)
        run_local
        ;;
    stop)
        stop_container
        ;;
    start)
        start_container
        ;;
    restart)
        restart_container
        ;;
    logs)
        view_logs
        ;;
    logs-follow)
        follow_logs
        ;;
    shell)
        open_shell
        ;;
    push)
        push_image
        ;;
    pull)
        pull_image
        ;;
    remove)
        remove_container
        ;;
    status)
        show_status
        ;;
    clean)
        clean_docker
        ;;
    help|--help|-h|"")
        show_help
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        echo ""
        show_help
        exit 1
        ;;
esac
