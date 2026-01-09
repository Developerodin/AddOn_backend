# Docker Troubleshooting Guide

## Issue: Container runs but localhost:3000 not accessible

### Problem
Container is running but you can't access http://localhost:3000

### Common Causes & Solutions

#### 1. MongoDB Connection Issue (Most Common)

**Symptoms:**
- Container is running but no "Listening to port" in logs
- No "Connected to MongoDB" message
- Container appears healthy but app doesn't respond

**Solution:**

**If MongoDB is on your host machine (localhost):**

Update your `.env` file:
```env
# For Mac/Windows Docker Desktop
MONGODB_URL=mongodb://host.docker.internal:27017/addon

# For Linux Docker
MONGODB_URL=mongodb://172.17.0.1:27017/addon
```

**If MongoDB is remote (MongoDB Atlas, etc.):**
```env
MONGODB_URL=mongodb+srv://username:password@cluster.mongodb.net/dbname
```

**Check logs:**
```bash
docker logs addon-backend
```

You should see:
- "Connected to MongoDB"
- "Listening to port 3000"

If you see MongoDB connection errors, fix the MONGODB_URL in your `.env` file.

---

#### 2. Port Already in Use

**Symptoms:**
- Error: "port is already allocated"
- Another service using port 3000

**Solution:**

**Option A: Stop the conflicting service**
```bash
# Find what's using port 3000
lsof -i :3000  # Mac/Linux
netstat -ano | findstr :3000  # Windows

# Stop it or use different port
```

**Option B: Use different port**
Update `docker-compose.yml`:
```yaml
ports:
  - "3001:3000"  # Access on localhost:3001
```

Or run directly:
```bash
docker run -d --name addon-backend -p 3001:3000 --env-file .env addon-backend:latest
```

---

#### 3. Container Crashes Immediately

**Symptoms:**
- Container status shows "Exited"
- Container keeps restarting

**Solution:**

**Check logs:**
```bash
docker logs addon-backend
```

**Common issues:**
- Missing required environment variables
- Invalid MongoDB URL
- Invalid AWS credentials
- Missing .env file

**Fix:**
1. Ensure `.env` file exists and has all required variables
2. Check all values are correct (no typos)
3. Verify MongoDB URL is accessible from container

---

#### 4. Wrong Port Mapping

**Symptoms:**
- Container running but wrong port

**Check current mapping:**
```bash
docker ps
# Look at PORTS column: 0.0.0.0:3000->3000/tcp
```

**Fix:**
```bash
# Stop and remove
docker stop addon-backend
docker rm addon-backend

# Run with correct port
docker run -d --name addon-backend -p 3000:3000 --env-file .env addon-backend:latest
```

---

#### 5. .env File Not Found or Not Loaded

**Symptoms:**
- Environment variables not set
- Using default/empty values

**Solution:**

**Check if .env is loaded:**
```bash
docker exec addon-backend env | grep MONGODB_URL
```

**Fix:**
1. Ensure `.env` file exists in same directory as docker-compose.yml
2. Check file name is exactly `.env` (not `.env.txt` or `.env.example`)
3. Verify file has correct format (KEY=value, no spaces around =)

---

## Quick Diagnostic Commands

```bash
# Check container status
docker ps -a | grep addon-backend

# View logs
docker logs addon-backend
docker logs -f addon-backend  # follow logs

# Check if port is accessible
curl http://localhost:3000
# or
curl http://localhost:3001  # if using different port

# Check environment variables
docker exec addon-backend env | grep -E "MONGODB|PORT|NODE_ENV"

# Check if MongoDB URL is correct
docker exec addon-backend sh -c "echo \$MONGODB_URL"

# Test MongoDB connection from container
docker exec addon-backend node -e "const mongoose = require('mongoose'); mongoose.connect(process.env.MONGODB_URL).then(() => {console.log('Connected'); process.exit(0);}).catch(e => {console.error('Error:', e.message); process.exit(1);})"

# Restart container
docker restart addon-backend

# Rebuild and restart
docker-compose down
docker-compose up -d --build
```

---

## Step-by-Step Fix for "Not Running on localhost:3000"

### Step 1: Check Container Status
```bash
docker ps -a | grep addon-backend
```

### Step 2: Check Logs
```bash
docker logs addon-backend
```

Look for:
- ✅ "Connected to MongoDB" - Good!
- ✅ "Listening to port 3000" - Good!
- ❌ MongoDB connection errors - Fix MONGODB_URL
- ❌ Missing environment variables - Fix .env file

### Step 3: Fix MongoDB URL

**If MongoDB is on host machine:**
```bash
# Edit .env file
MONGODB_URL=mongodb://host.docker.internal:27017/addon
```

**If MongoDB is remote:**
```bash
MONGODB_URL=mongodb+srv://user:pass@cluster.mongodb.net/dbname
```

### Step 4: Restart Container
```bash
docker restart addon-backend
# or
docker-compose restart
```

### Step 5: Verify
```bash
# Check logs again
docker logs addon-backend

# Test connection
curl http://localhost:3000
```

---

## Common MongoDB URL Formats

```env
# Local MongoDB on host (Mac/Windows Docker Desktop)
MONGODB_URL=mongodb://host.docker.internal:27017/addon

# Local MongoDB on host (Linux Docker)
MONGODB_URL=mongodb://172.17.0.1:27017/addon

# MongoDB Atlas (Cloud)
MONGODB_URL=mongodb+srv://username:password@cluster.mongodb.net/dbname

# MongoDB with authentication
MONGODB_URL=mongodb://username:password@host:27017/dbname

# MongoDB replica set
MONGODB_URL=mongodb://host1:27017,host2:27017/dbname?replicaSet=rs0
```

---

## Still Not Working?

1. **Rebuild the image** with the fixed code:
   ```bash
   ./docker-commands.sh rebuild
   ```

2. **Check Docker Desktop** is running

3. **Check firewall** isn't blocking port 3000

4. **Try accessing from container**:
   ```bash
   docker exec addon-backend curl http://localhost:3000
   ```

5. **Check network**:
   ```bash
   docker network inspect addon-network
   ```
