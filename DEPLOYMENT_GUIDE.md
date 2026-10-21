# VPS Deployment Guide: Host Online 24/7

This guide explains how to deploy this application to a small cloud VPS (Ubuntu 22.04 / 24.04 on DigitalOcean, Linode, AWS EC2, or Hetzner) for ₹400–₹800/month.

---

## 1. Prerequisites on the VPS
Connect to your VPS via SSH:
```bash
ssh root@YOUR_SERVER_IP
```

Install Git, Node.js, Python 3, SQLite3, and Nginx:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-pip python3-venv nodejs npm sqlite3 nginx ufw
```

---

## 2. Clone / Copy Repository
```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/cert-chain-project.git /var/www/cert-chain-project
cd /var/www/cert-chain-project
```

Set up Python virtual environment & dependencies:
```bash
python3 -m venv venv
./venv/bin/pip install -r python-service/requirements.txt
```

Set up Node.js dependencies:
```bash
cd /var/www/cert-chain-project/backend
npm install --production
```

---

## 3. Set Up Background Services (systemd)

### Service 1: Python Blockchain Service
Create `/etc/systemd/system/cert-python.service`:
```ini
[Unit]
Description=Python Blockchain & Cryptography Service
After=network.target

[Service]
User=root
WorkingDirectory=/var/www/cert-chain-project/python-service
ExecStart=/var/www/cert-chain-project/venv/bin/python app.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### Service 2: Node.js Backend Service
Create `/etc/systemd/system/cert-node.service`:
```ini
[Unit]
Description=Node.js Certificate Web Backend
After=network.target cert-python.service

[Service]
User=root
WorkingDirectory=/var/www/cert-chain-project/backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

Enable and start both services:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cert-python
sudo systemctl enable --now cert-node
```

Check their status:
```bash
sudo systemctl status cert-python
sudo systemctl status cert-node
```

---

## 4. Configure Nginx Reverse Proxy
Edit `/etc/nginx/sites-available/default`:
```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_SERVER_IP;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Test and reload Nginx:
```bash
sudo nginx -t
sudo systemctl restart nginx
```

---

## 5. Enable HTTPS (Free TLS Certificate)
If you connected a domain name (e.g. `certs.yourdomain.com`):
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN
```

Certbot will automatically install the TLS certificate and configure HTTPS auto-renewal.

---

## 6. Configure UFW Firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

The portal is now running 24/7 and publicly accessible from any laptop worldwide.

---

## 7. Alternative: 1-Click Docker Compose Deployment

If your server has Docker & Docker Compose installed, you can launch the entire stack in one command:

```bash
# 1. Clone repository
git clone https://github.com/YOUR_GITHUB_USERNAME/cert-chain-project.git
cd cert-chain-project

# 2. Configure environment
cp .env.example .env

# 3. Launch both containers (Node backend + Python Blockchain) in background
docker compose up -d --build
```

The app will be running immediately on `http://YOUR_SERVER_IP:3000` with automatic volume persistence in `./storage`.

To view container logs:
```bash
docker compose logs -f
```

To stop containers:
```bash
docker compose down
```

---

## 8. Alternative: PM2 Process Manager Deployment

If deploying directly on a VPS without Docker, you can use PM2 to manage both services:

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start both Node & Python services using the ecosystem config
pm2 start ecosystem.config.js

# Configure PM2 to restart on server reboot
pm2 startup
pm2 save
```

View live monitor:
```bash
pm2 status
pm2 logs
```

