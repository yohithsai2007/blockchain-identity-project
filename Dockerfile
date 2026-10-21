# Start with official Node.js 20 image (Debian Linux base)
FROM node:20-bookworm-slim

# Install Python 3, pip, and build tools (for SQLite / crypto libraries)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Install Python dependencies inside a virtual environment
COPY python-service/requirements.txt ./python-service/
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir -r ./python-service/requirements.txt

# 2. Install Node.js backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production

# 3. Copy source code, frontend, and initial storage assets
COPY python-service ./python-service
COPY backend ./backend
COPY frontend ./frontend
COPY storage ./storage

# 4. Ensure persistent storage folders exist
RUN mkdir -p /app/backend/storage/certificates \
             /app/python-service/storage/certificates \
             /app/storage/certificates \
             /app/storage/data \
             /app/storage/keys \
             /app/storage/temp_uploads

# 5. Create startup script to run Python (5001) in background & Node (PORT) in foreground
RUN printf '#!/bin/sh\n\
echo "Starting Python Blockchain Service on 127.0.0.1:5001..."\n\
cd /app/python-service && python3 app.py &\n\
sleep 2\n\
echo "Starting Node.js Backend on port ${PORT:-3000}..."\n\
cd /app/backend && node server.js\n' > /app/start.sh && chmod +x /app/start.sh

EXPOSE 3000

CMD ["/app/start.sh"]
