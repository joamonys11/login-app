const express = require('express');
const mariadb = require('mariadb');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3306;

// ✅ Trust Railway proxy to get correct IPs
app.set('trust proxy', 1);

// ✅ Connect to AlwaysData MariaDB
const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: 3306,
  connectionLimit: 5
});

// ✅ Rate limiter to protect login endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24,
  }
}));

// ✅ Init DB & Seed users if needed
async function initDatabase() {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name VARCHAR(255),
        age INT,
        email VARCHAR(255),
        study VARCHAR(255),
        civil_status VARCHAR(255),
        avatar TEXT,
        login_count INT DEFAULT 0
      )
    `);

    const result = await conn.query('SELECT COUNT(*) as count FROM users');
    if (result[0].count === 0) await createDefaultUsers(conn);

    console.log('✅ Database initialized');
  } catch (err) {
    console.error('❌ DB Init Error:', err);
  } finally {
    if (conn) conn.release();
  }
}

async function createDefaultUsers(conn) {
  const users = [
    {
      username: 'admin', password: 'admin123', name: 'Admin User',
      age: 35, email: 'admin@site.com', study: 'IT',
      civil_status: 'Single', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin'
    },
    {
      username: 'user', password: 'password', name: 'Normal User',
      age: 28, email: 'user@site.com', study: 'Business',
      civil_status: 'Single', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user'
    },
    {
      username: 'john', password: 'john123', name: 'John Smith',
      age: 32, email: 'john@site.com', study: 'Engineering',
      civil_status: 'Married', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=john'
    }
  ];

  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 12);
    await conn.query(
      `INSERT INTO users (username, password_hash, name, age, email, study, civil_status, avatar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [u.username, hash, u.name, u.age, u.email, u.study, u.civil_status, u.avatar]
    );
  }
  console.log('✅ Seed users created');
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Auth required' });
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  let conn;

  try {
    if (!username || !password) {
      return res.json({ success: false, error: 'Missing username or password' });
    }

    conn = await pool.getConnection();
    const rows = await conn.query('SELECT * FROM users WHERE username = ?', [username]);

    if (rows.length === 0 || !rows[0].password_hash) {
      return res.json({ success: false, error: 'Invalid credentials' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) return res.json({ success: false, error: 'Invalid credentials' });

    // Login successful
    req.session.userId = user.id;

    res.json({
      success: true,
      user: {
        username: user.username,
        name: user.name,
        age: user.age,
        email: user.email,
        study: user.study,
        civil_status: user.civil_status,
        avatar: user.avatar,
        login_count: user.login_count,
        days_active: 5,
        profile_views: 300
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/profile', requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT * FROM users WHERE id = ?', [req.session.userId]);

    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    res.json({ user: rows[0] });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ success: true });
  });
});

// ✅ Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong' });
});

// ✅ Start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});
