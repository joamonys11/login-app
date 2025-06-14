
# 🚀 Login App with Node.js + MariaDB

This is a full-stack login application built with:
- **Frontend**: HTML + CSS + JavaScript
- **Backend**: Node.js + Express
- **Database**: MariaDB

---

## ✅ How to Deploy on a VPS (Ubuntu)

### 1. 🖥️ Get a VPS
Use providers like DigitalOcean, Linode, Hetzner, or AWS EC2. Choose Ubuntu 22.04.

SSH into your server:

```bash
ssh root@your_server_ip
```

---

### 2. 🔧 Install Required Software

#### Node.js + npm
```bash
sudo apt update
sudo apt install nodejs npm -y
```

#### MariaDB Server
```bash
sudo apt install mariadb-server -y
sudo mysql_secure_installation
```

Start and enable MariaDB:

```bash
sudo systemctl start mariadb
sudo systemctl enable mariadb
```

---

### 3. 🗃️ Create the Database

```bash
sudo mariadb
```

Run:

```sql
CREATE DATABASE login_app;
CREATE USER 'login_user'@'localhost' IDENTIFIED BY 'strongpassword';
GRANT ALL PRIVILEGES ON login_app.* TO 'login_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

---

### 4. 📦 Upload and Configure Project

Upload ZIP from local machine:

```bash
scp login-app.zip root@your_server_ip:/root
```

Unzip and install:

```bash
cd /root
unzip login-app.zip
cd login-app
nano .env
```

Set your `.env`:

```env
DB_HOST=localhost
DB_USER=login_user
DB_PASSWORD=strongpassword
DB_NAME=login_app
PORT=3000
```

Install dependencies:

```bash
npm install
```

---

### 5. ▶️ Start the Server

```bash
node server.js
```

Go to: `http://your_server_ip:3000`

---

### 6. 🔁 Use PM2 to Keep It Running

```bash
npm install -g pm2
pm2 start server.js
pm2 save
pm2 startup
```

---

### 7. 🌐 Optional: Set Up NGINX + Domain + HTTPS

Install NGINX:

```bash
sudo apt install nginx -y
```

Create config:

```bash
sudo nano /etc/nginx/sites-available/login-app
```

Paste:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable and test:

```bash
sudo ln -s /etc/nginx/sites-available/login-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

### 8. 🔐 HTTPS with Let’s Encrypt

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com
```

---

## ✅ You’re Done!

Access your app at `http://yourdomain.com` or your IP.

Let me know if you want:
- SQL inserts with hashed passwords
- Docker deployment
