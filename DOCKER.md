# Docker Setup Guide - Complete Reference

## 🚀 Quick Start

### First Time Setup (On Your Development Machine)

1. **Login to Docker Hub:**
   ```bash
   docker login
   ```

2. **Set your Docker Hub username:**
   ```bash
   export DOCKER_USERNAME=your-username
   ```

3. **Build the image:**
   ```bash
   ./docker-commands.sh build
   ```

4. **Push to Docker Hub:**
   ```bash
   ./docker-commands.sh push
   ```

### On Other Laptops (Pull and Run)

1. **Login to Docker Hub:**
   ```bash
   docker login
   ```

2. **Set your Docker Hub username:**
   ```bash
   export DOCKER_USERNAME=your-username
   ```

3. **Pull the image:**
   ```bash
   ./docker-commands.sh pull
   ```

4. **Create .env file** (copy from your main machine or set up environment variables)

5. **Run the container:**
   ```bash
   ./docker-commands.sh run
   ```

---

## 📋 All Available Commands

Use the `docker-commands.sh` script for easy management:

```bash
./docker-commands.sh [command]
```

### Build Commands
- `build` - Build the Docker image locally
- `rebuild` - Rebuild the Docker image (no cache, fresh build)

### Run Commands
- `run` - Run the container using docker-compose (recommended)
- `run-local` - Run container directly (without docker-compose)

### Container Management
- `start` - Start the stopped container
- `stop` - Stop the running container
- `restart` - Restart the container
- `status` - Show container and image status

### Logs & Debugging
- `logs` - View container logs
- `logs-follow` - Follow container logs in real-time (Ctrl+C to exit)
- `shell` - Open shell/terminal in running container

### Docker Hub Commands
- `push` - Push image to Docker Hub
- `pull` - Pull image from Docker Hub

### Cleanup
- `remove` - Remove container and image
- `clean` - Clean up stopped containers and unused images

### Help
- `help` - Show all available commands

---

## 🔧 Detailed Usage Examples

### Building the Image

**Build locally:**
```bash
DOCKER_USERNAME=myuser ./docker-commands.sh build
```

**Rebuild from scratch (no cache):**
```bash
DOCKER_USERNAME=myuser ./docker-commands.sh rebuild
```

**Manual build:**
```bash
docker build -t myuser/addon-backend:latest .
```

### Running the Container

**Using docker-compose (recommended):**
```bash
DOCKER_USERNAME=myuser ./docker-commands.sh run
```

**Or manually with docker-compose:**
```bash
DOCKER_USERNAME=myuser docker-compose up -d
```

**Run directly (without compose):**
```bash
./docker-commands.sh run-local
```

**Manual run:**
```bash
docker run -d \
  --name addon-backend \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  myuser/addon-backend:latest
```

### Viewing Logs

**View logs:**
```bash
./docker-commands.sh logs
```

**Follow logs (live):**
```bash
./docker-commands.sh logs-follow
```

**Manual:**
```bash
docker logs addon-backend
docker logs -f addon-backend  # follow mode
```

### Container Management

**Start/Stop/Restart:**
```bash
./docker-commands.sh start
./docker-commands.sh stop
./docker-commands.sh restart
```

**Check status:**
```bash
./docker-commands.sh status
```

**Open shell in container:**
```bash
./docker-commands.sh shell
```

### Pushing to Docker Hub

**Push image:**
```bash
DOCKER_USERNAME=myuser VERSION=latest ./docker-commands.sh push
```

**Push with version tag:**
```bash
DOCKER_USERNAME=myuser VERSION=v1.0.0 ./docker-commands.sh push
```

**Manual push:**
```bash
docker tag addon-backend:latest myuser/addon-backend:latest
docker push myuser/addon-backend:latest
```

### Pulling on Another Machine

**Pull and run:**
```bash
# 1. Login
docker login

# 2. Set username
export DOCKER_USERNAME=myuser

# 3. Pull
./docker-commands.sh pull

# 4. Create .env file with your environment variables

# 5. Run
./docker-commands.sh run
```

---

## 🐳 Docker Compose Usage

The `docker-compose.yml` file makes it easy to manage the container:

**Start:**
```bash
docker-compose up -d
```

**Stop:**
```bash
docker-compose down
```

**View logs:**
```bash
docker-compose logs -f
```

**Restart:**
```bash
docker-compose restart
```

**Rebuild and restart:**
```bash
docker-compose up -d --build
```

---

## 📝 Environment Variables

Create a `.env` file in the project root with:

```env
NODE_ENV=production
PORT=3000
MONGODB_URL=mongodb://your-mongodb-url
JWT_SECRET=your-secret-key
JWT_ACCESS_EXPIRATION_MINUTES=30
JWT_REFRESH_EXPIRATION_DAYS=30
AWS_ACCESS_KEY_ID=your-aws-key
AWS_SECRET_ACCESS_KEY=your-aws-secret
AWS_REGION=your-region
AWS_BUCKET_NAME=your-bucket-name
OPENAI_API_KEY=your-openai-key

# Optional Email Settings
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email
SMTP_PASSWORD=your-password
EMAIL_FROM=noreply@yourapp.com
```

**Important:** Never commit `.env` file to git! It's already in `.dockerignore`.

---

## 🔄 Complete Workflow Examples

### Workflow 1: Build and Push (First Time)

```bash
# 1. Set your Docker Hub username
export DOCKER_USERNAME=myuser

# 2. Build the image
./docker-commands.sh build

# 3. Push to Docker Hub
./docker-commands.sh push
```

### Workflow 2: Update and Re-push

```bash
# 1. Make code changes
# ... edit your code ...

# 2. Rebuild
./docker-commands.sh rebuild

# 3. Push new version
./docker-commands.sh push

# Or push with version tag
VERSION=v1.1.0 ./docker-commands.sh push
```

### Workflow 3: Run on Another Laptop

```bash
# 1. Clone or copy project files (or just docker-compose.yml and .env)

# 2. Login to Docker Hub
docker login

# 3. Set username
export DOCKER_USERNAME=myuser

# 4. Pull latest image
./docker-commands.sh pull

# 5. Create .env file with your environment variables

# 6. Run
./docker-commands.sh run

# 7. Check logs
./docker-commands.sh logs-follow
```

### Workflow 4: Development Cycle

```bash
# Start container
./docker-commands.sh run

# View logs
./docker-commands.sh logs-follow

# Make changes, rebuild
./docker-commands.sh rebuild

# Restart container
./docker-commands.sh restart

# Stop when done
./docker-commands.sh stop
```

---

## 🛠️ Troubleshooting

### Container won't start
```bash
# Check logs
./docker-commands.sh logs

# Check status
./docker-commands.sh status

# Verify .env file exists and has all required variables
cat .env
```

### Port already in use
```bash
# Change port in docker-compose.yml or use:
docker run -p 3001:3000 ...
```

### Image not found
```bash
# Make sure you've pulled the image
./docker-commands.sh pull

# Or build locally
./docker-commands.sh build
```

### Permission denied
```bash
# Make script executable
chmod +x docker-commands.sh
```

### Docker login issues
```bash
# Re-login
docker logout
docker login
```

---

## 📦 Files Created

- `Dockerfile` - Docker image definition
- `.dockerignore` - Files to exclude from build
- `docker-compose.yml` - Container orchestration
- `docker-commands.sh` - Helper script with all commands
- `docker-build-push.sh` - Alternative build/push script
- `DOCKER.md` - This documentation

---

## 🎯 Quick Reference Card

```bash
# Build
./docker-commands.sh build

# Run
./docker-commands.sh run

# Logs
./docker-commands.sh logs-follow

# Stop
./docker-commands.sh stop

# Push
DOCKER_USERNAME=myuser ./docker-commands.sh push

# Pull
DOCKER_USERNAME=myuser ./docker-commands.sh pull

# Status
./docker-commands.sh status
```

---

## 💡 Tips

1. **Always set DOCKER_USERNAME** before building/pushing:
   ```bash
   export DOCKER_USERNAME=myuser
   ```

2. **Use version tags** for production:
   ```bash
   VERSION=v1.0.0 ./docker-commands.sh push
   ```

3. **Keep .env file secure** - never commit it to git

4. **Use docker-compose** for easier management

5. **Check logs first** when something doesn't work:
   ```bash
   ./docker-commands.sh logs
   ```
