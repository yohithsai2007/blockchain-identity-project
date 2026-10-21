FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Install Python dependencies
COPY python-service/requirements.txt ./python-service/
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir -r ./python-service/requirements.txt

# 2. Install Node dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production

# 3. Copy application files, frontend assets, and initial storage
COPY python-service ./python-service
COPY backend ./backend
COPY frontend ./frontend
COPY storage ./storage

RUN mkdir -p /app/backend/storage/certificates /app/python-service/storage/certificates /app/storage/certificates /app/storage/data /app/storage/keys /app/storage/temp_uploads

# 4. Startup script: Run Python on port 5001 in background, Node on Render's assigned $PORT in foreground
RUN printf '#!/bin/sh\n\
cd /app/python-service && PORT=5001 python3 app.py &\n\
sleep 2\n\
cd /app/backend && node server.js\n' > /app/start.sh && chmod +x /app/start.sh

EXPOSE 10000

CMD ["/app/start.sh"]
