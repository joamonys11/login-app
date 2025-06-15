// Full backend code for secure MariaDB login system using Express.js

const express = require('express');
const mariadb = require('mariadb');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = mariadb.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'login_app',
  connectionLimit: 10,
  acquireTimeout: 60000,
  timeout: 60000
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later.',
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
    maxAge: 1000 * 60 * 60 * 24
  }
}));

async function initDatabase() {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(100) NOT NULL,
        age INT,
        email VARCHAR(100) UNIQUE NOT NULL,
        study VARCHAR(200),
        civil_status VARCHAR(50),
        avatar VARCHAR(500),
        login_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP NULL,
        is_active BOOLEAN DEFAULT TRUE
      )`);

    const result = await conn.query('SELECT COUNT(*) as count FROM users');
    if (result[0].count === 0) {
      await createDefaultUsers(conn);
    }

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
      username: 'admin', password: 'admin123', name: 'Alexandra Martinez', age: 28,
      email: 'alexandra.martinez@email.com', study: 'Computer Science - Master\'s Degree',
      civil_status: 'Single', avatar: 'https://images.unsplash.com/photo-1494790108755-2616b9fd0d6f?w=150&h=150&fit=crop&crop=face'
    },
    {
      username: 'user', password: 'password', name: 'Michael Thompson', age: 35,
      email: 'michael.thompson@email.com', study: 'Business Administration - MBA',
      civil_status: 'Married', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face'
    },
    {
      username: 'john', password: 'john123', name: 'John Anderson', age: 24,
      email: 'john.anderson@email.com', study: 'Mechanical Engineering - Bachelor\'s Degree',
      civil_status: 'In a Relationship', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face'
    }
  ];

  for (const user of users) {
    const hash = await bcrypt.hash(user.password, 12);
    await conn.query(`
      INSERT INTO users (username, password_hash, name, age, email, study, civil_status, avatar)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [user.username, hash, user.name, user.age, user.email, user.study, user.civil_status, user.avatar]);
  }

  console.log('✅ Default users created');
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  let conn;

  try {
    conn = await pool.getConnection();
    const users = await conn.query('SELECT * FROM users WHERE username = ?', [username]);

    if (!users.length) {
      return res.json({ success: false, error: 'Invalid credentials' });
    }

    const user = users[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.json({ success: false, error: 'Invalid credentials' });
    }

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
        days_active: 0,
        profile_views: 0
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

    const users = await conn.query('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!users.length) return res.status(404).json({ error: 'User not found' });

    const stats = await conn.query('SELECT COUNT(*) as total_sessions, MIN(session_start) as first_login FROM user_sessions WHERE user_id = ?', [req.session.userId]);
    const daysActive = stats[0].first_login ? Math.floor((Date.now() - new Date(stats[0].first_login).getTime()) / (1000 * 60 * 60 * 24)) : 0;

    res.json({
      user: users[0],
      stats: {
        totalSessions: stats[0].total_sessions,
        daysActive,
        profileViews: Math.floor(Math.random() * 150) + 30
      }
    });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
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

app.get('/api/auth-status', (req, res) => {
  res.json({ authenticated: !!req.session?.userId });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Gracefully shutting down...');
  await pool.end();
  process.exit(0);
});
