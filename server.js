// server.js
//require('dotenv').config();
const DEMO_INJECTION = true;
const express = require('express');
const mariadb = require('mariadb');
//const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const rateLimit = require('express-rate-limit');


const app = express();
const PORT = process.env.PORT || 3306;  

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

console.log('🔐 DEMO_INJECTION mode:', DEMO_INJECTION ? 'ENABLED' : 'DISABLED');
console.log('📦 DB Host:', process.env.DB_HOST || 'localhost');

app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 86400000 }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Try again later.'
});

const pool = mariadb.createPool({
  host: process.env.DB_HOST || 'mysql-logindb.alwaysdata.net',
  user: process.env.DB_USER || 'logindb',
  password: process.env.DB_PASSWORD || '@Joe105411',
  database: process.env.DB_NAME || 'logindb_app',
  connectionLimit: 10,
  acquireTimeout: 60000,
  timeout: 60000
});

async function initDatabase() {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE,
    password VARCHAR(255),  -- Changed from password_hash
    name VARCHAR(100),
    age INT,
    email VARCHAR(100) UNIQUE,
    study VARCHAR(255),
    civil_status VARCHAR(100),
    avatar VARCHAR(500),
    login_count INT DEFAULT 0,
    last_login TIMESTAMP NULL,
    is_active BOOLEAN DEFAULT TRUE
  )
    `);
    const existing = await conn.query('SELECT COUNT(*) as count FROM users');
    if (existing[0].count === 0) {
      const users = [
        ['admin', 'admin123', 'Admin One', 30, 'admin@email.com', 'IT', 'Single',
          'https://randomuser.me/api/portraits/men/1.jpg'],
        ['user', 'password', 'User Two', 25, 'user@email.com', 'Business', 'Married',
          'https://randomuser.me/api/portraits/women/1.jpg']
      ];
      for (const [username, pass, name, age, email, study, civil, avatar] of users) {
        await conn.query(
  `INSERT INTO users (username, password, name, age, email, study, civil_status, avatar)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [username, pass, name, age, email, study, civil, avatar]
);
      }
      console.log('✅ Demo users created');
    }
  } catch (err) {
    console.error('DB Init Error:', err);
  } finally {
    if (conn) conn.release();
  }
}

app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();

    let sqlPreview = `SELECT * FROM users WHERE username = '${username}'`;
    const users = await conn.query(sqlPreview);

    if (!users.length) {
      return res.status(401).json({ error: 'Invalid username or password', sqlPreview });
    }

    const user = users[0];

    // 🔍 Debug output
    console.log('User from DB:', user);
    console.log('Submitted password:', password);

    const valid = DEMO_INJECTION || user.password === password;

    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password', sqlPreview });
    }

    await conn.query('UPDATE users SET login_count = login_count + 1, last_login = NOW() WHERE id = ?', [user.id]);
    req.session.userId = user.id;

    delete user.password;  // 🔥 This might cause issue if `password` doesn't exist

    res.json({ success: true, user, sqlPreview });

  } catch (err) {
    console.error('❌ Login Error:', err);  // 🔍 Look here in your terminal logs
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/profile', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  let conn;
  try {
    conn = await pool.getConnection();
    const [user] = await conn.query(
      `SELECT id, username, name, age, email, study, civil_status, avatar, login_count, last_login 
       FROM users WHERE id = ?`, [req.session.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Profile error' });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get('/api/auth-status', (req, res) => {
  res.json({ authenticated: !!req.session.userId });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Unexpected server error' });
});

initDatabase().then(() => {
  app.listen(PORT, () => {
  console.log(`🔐 SQL Injection Demo Mode: ${DEMO_INJECTION ? 'ENABLED' : 'DISABLED'}`);
  });
});
