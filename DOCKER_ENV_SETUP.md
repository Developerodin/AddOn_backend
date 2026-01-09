# Setting Up .env File for Docker Image (Docker Desktop)

## Important: .env File is NOT in the Image

The `.env` file is **NOT included** in the Docker image (it's in `.dockerignore` for security). You need to create it on your local machine and provide it when running the container.

---

## Method 1: Using Docker Desktop GUI (Easiest)

### Step 1: Pull the Image
1. Open Docker Desktop
2. Go to **Images** tab
3. Click **Pull** button
4. Enter: `your-username/addon-backend:latest`
5. Click **Pull**

### Step 2: Create .env File
1. Create a new file named `.env` in any folder (e.g., `C:\docker-projects\addon-backend\.env`)
2. Add all your environment variables:

```env
NODE_ENV=production
PORT=3000
MONGODB_URL=mongodb://your-mongodb-url
JWT_SECRET=your-jwt-secret-key-here
JWT_ACCESS_EXPIRATION_MINUTES=30
JWT_REFRESH_EXPIRATION_DAYS=30
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1
AWS_BUCKET_NAME=your-bucket-name
OPENAI_API_KEY=your-openai-api-key

# Optional Email Settings
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password
EMAIL_FROM=noreply@yourapp.com
```

### Step 3: Run Container with .env File
1. In Docker Desktop, go to **Containers** tab
2. Click **Run** button
3. Select your image: `your-username/addon-backend:latest`
4. Click **Optional settings**
5. Under **Environment variables**:
   - Click **Env file** tab
   - Click **Browse** and select your `.env` file
6. Under **Ports**:
   - Host port: `3000`
   - Container port: `3000`
7. Click **Run**

---

## Method 2: Using Command Line (PowerShell/Git Bash)

### Step 1: Pull the Image
```bash
docker pull your-username/addon-backend:latest
```

### Step 2: Create .env File
Create a `.env` file in any folder with your environment variables (same content as above).

### Step 3: Run Container
```bash
# Navigate to folder where .env file is located
cd C:\docker-projects\addon-backend

# Run container with .env file
docker run -d \
  --name addon-backend \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  your-username/addon-backend:latest
```

---

## Method 3: Using Docker Compose (Recommended)

### Step 1: Create docker-compose.yml
Create a file named `docker-compose.yml` in a folder:

```yaml
version: '3.8'

services:
  addon-backend:
    image: your-username/addon-backend:latest
    container_name: addon-backend
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env
```

### Step 2: Create .env File
Create `.env` file in the same folder with your environment variables.

### Step 3: Run with Docker Compose
```bash
# In PowerShell or Git Bash
docker-compose up -d
```

---

## Method 4: Set Environment Variables Directly in Docker Desktop

1. Open Docker Desktop
2. Go to **Containers** → **Run**
3. Select your image
4. Click **Optional settings**
5. Under **Environment variables**, click **Add** for each variable:
   - `NODE_ENV` = `production`
   - `PORT` = `3000`
   - `MONGODB_URL` = `your-mongodb-url`
   - `JWT_SECRET` = `your-secret`
   - etc.

**Note:** This method is tedious if you have many variables. Use `.env` file instead.

---

## Complete Step-by-Step Guide for Windows

### Setup (One Time)

1. **Install Docker Desktop** (if not already installed)
   - Download from: https://www.docker.com/products/docker-desktop

2. **Create a project folder:**
   ```
   C:\docker-projects\addon-backend\
   ```

3. **Create .env file** in that folder:
   - Right-click → New → Text Document
   - Rename to `.env` (remove .txt extension)
   - Open with Notepad and paste your environment variables

4. **Create docker-compose.yml** in the same folder:
   ```yaml
   version: '3.8'
   
   services:
     addon-backend:
       image: your-username/addon-backend:latest
       container_name: addon-backend
       restart: unless-stopped
       ports:
         - "3000:3000"
       env_file:
         - .env
   ```

### Daily Usage

1. **Pull latest image** (if updated):
   ```bash
   docker pull your-username/addon-backend:latest
   ```

2. **Start container:**
   ```bash
   cd C:\docker-projects\addon-backend
   docker-compose up -d
   ```

3. **View logs:**
   ```bash
   docker logs addon-backend
   docker logs -f addon-backend  # follow logs
   ```

4. **Stop container:**
   ```bash
   docker-compose down
   # or
   docker stop addon-backend
   ```

---

## Required Environment Variables

Your `.env` file **MUST** include these (get values from your main development machine):

```env
# Required
NODE_ENV=production
PORT=3000
MONGODB_URL=mongodb+srv://username:password@cluster.mongodb.net/dbname
JWT_SECRET=your-very-long-random-secret-key-here
JWT_ACCESS_EXPIRATION_MINUTES=30
JWT_REFRESH_EXPIRATION_DAYS=30
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
AWS_BUCKET_NAME=your-bucket-name
OPENAI_API_KEY=sk-...

# Optional (for email features)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password
EMAIL_FROM=noreply@yourapp.com
```

---

## How to Get Your .env Values

### Option 1: Copy from Development Machine
- Copy the `.env` file from your main development machine
- Transfer it to your Windows laptop (USB, email, cloud storage, etc.)

### Option 2: Create New .env
- Ask your team/colleague for the environment variable values
- Or check your deployment platform (AWS, Heroku, etc.) for environment variables

### Option 3: Export from Existing Container
If you have access to a running container:
```bash
docker exec addon-backend env > .env
```

---

## Troubleshooting

### Container won't start
```bash
# Check logs
docker logs addon-backend

# Common issues:
# - Missing required env variables
# - Wrong MongoDB URL
# - Invalid credentials
```

### .env file not found
- Make sure `.env` file is in the same folder as `docker-compose.yml`
- Check file name is exactly `.env` (not `.env.txt`)
- In Windows, you may need to show file extensions

### Port already in use
```yaml
# Change port in docker-compose.yml
ports:
  - "3001:3000"  # Use port 3001 on host
```

### Permission issues
- Make sure Docker Desktop is running
- Run PowerShell as Administrator if needed

---

## Quick Reference

```bash
# Pull image
docker pull your-username/addon-backend:latest

# Run with .env file
docker run -d --name addon-backend -p 3000:3000 --env-file .env your-username/addon-backend:latest

# Or use docker-compose (easier)
docker-compose up -d

# View logs
docker logs -f addon-backend

# Stop
docker stop addon-backend
# or
docker-compose down
```

---

## Summary

1. ✅ **Image does NOT contain .env** (for security)
2. ✅ **Create .env file** on your Windows machine
3. ✅ **Use `--env-file .env`** when running container
4. ✅ **Easiest method:** Use `docker-compose.yml` with `env_file: - .env`

The `.env` file stays on your local machine and is never pushed to Docker Hub - this is the secure way to handle secrets!


Using Docker Desktop GUI
Pull the image in Docker Desktop
Click Run
In Optional settings → Environment variables → Env file tab
Browse and select your .env file
Set port: 3000 → 3000
Click Run
Files created
DOCKER_ENV_SETUP.md - Complete guide for setting up .env
docker-compose-simple.yml - Simple compose file
env.template - Template for your .env file
The .env file stays on your local machine and is never in the Docker image. This is the secure way to handle secrets.



# Tag with version
docker tag addon-frontend:latest akshaypareek/addon-frontend:v1.0.0

# Push both
docker push akshaypareek/addon-frontend:latest
docker push akshaypareek/addon-frontend:v1.0.0