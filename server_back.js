// server.js
const express = require('express');
const mariadb = require('mariadb');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3306;

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true in production with HTTPS
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// MariaDB connection pool
const pool = mariadb.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'login_app',
  connectionLimit: 10,
  acquireTimeout: 60000,
  timeout: 60000
});

// Database initialization
async function initDatabase() {
  let conn;
  try {
    conn = await pool.getConnection();
    
    // Create users table
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
      )
    `);
    
    // Create sessions table for tracking
    await conn.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        session_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    
    // Check if we need to create default users
    const userCount = await conn.query('SELECT COUNT(*) as count FROM users');
    if (userCount[0].count === 0) {
      await createDefaultUsers(conn);
    }
    
    console.log('Database initialized successfully');
    
  } catch (err) {
    console.error('Database initialization error:', err);
  } finally {
    if (conn) conn.release();
  }
}

// Create default users with hashed passwords
async function createDefaultUsers(conn) {
  const defaultUsers = [
    {
      username: 'admin',
      password: 'admin123',
      name: 'Alexandra Martinez',
      age: 28,
      email: 'alexandra.martinez@email.com',
      study: 'Computer Science - Master\'s Degree',
      civil_status: 'Single',
      avatar: 'https://images.unsplash.com/photo-1494790108755-2616b9fd0d6f?w=150&h=150&fit=crop&crop=face'
    },
    {
      username: 'user',
      password: 'password',
      name: 'Michael Thompson',
      age: 35,
      email: 'michael.thompson@email.com',
      study: 'Business Administration - MBA',
      civil_status: 'Married',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face'
    },
    {
      username: 'john',
      password: 'john123',
      name: 'John Anderson',
      age: 24,
      email: 'john.anderson@email.com',
      study: 'Mechanical Engineering - Bachelor\'s Degree',
      civil_status: 'In a Relationship',
      avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face'
    }
  ];
  
  for (const user of defaultUsers) {
    const hashedPassword = await bcrypt.hash(user.password, 12);
    await conn.query(`
      INSERT INTO users (username, password_hash, name, age, email, study, civil_status, avatar)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [user.username, hashedPassword, user.name, user.age, user.email, user.study, user.civil_status, user.avatar]);
  }
  
  console.log('Default users created successfully');
}

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  } else {
    return res.status(401).json({ error: 'Authentication required' });
  }
}

// Routes

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login endpoint
app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ 
      error: 'Username and password are required',
      sqlQuery: `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`
    });
  }
  
  let conn;
  try {
    conn = await pool.getConnection();
    
    // Use parameterized query to prevent SQL injection
    const users = await conn.query(
      'SELECT id, username, password_hash, name, age, email, study, civil_status, avatar, login_count FROM users WHERE username = ? AND is_active = TRUE',
      [username]
    );
    
    if (users.length === 0) {
      return res.status(401).json({ 
        error: 'Invalid username or password',
        sqlQuery: `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`
      });
    }
    
    const user = users[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    
    if (!passwordMatch) {
      return res.status(401).json({ 
        error: 'Invalid username or password',
        sqlQuery: `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`
      });
    }
    
    // Update login count and last login
    await conn.query(
      'UPDATE users SET login_count = login_count + 1, last_login = NOW() WHERE id = ?',
      [user.id]
    );
    
    // Log the session
    await conn.query(
      'INSERT INTO user_sessions (user_id, ip_address, user_agent) VALUES (?, ?, ?)',
      [user.id, req.ip, req.get('User-Agent')]
    );
    
    // Set session
    req.session.userId = user.id;
    req.session.username = user.username;
    
    // Remove password hash from response
    delete user.password_hash;
    user.login_count += 1;
    
    res.json({ 
      success: true, 
      user: user,
      message: 'Login successful',
      sqlQuery: `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`
    });
    
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (conn) conn.release();
  }
});

// Get user profile
app.get('/api/profile', requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    
    const users = await conn.query(
      'SELECT id, username, name, age, email, study, civil_status, avatar, login_count, created_at, last_login FROM users WHERE id = ?',
      [req.session.userId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = users[0];
    
    // Get session statistics
    const sessionStats = await conn.query(
      'SELECT COUNT(*) as total_sessions, MIN(session_start) as first_login FROM user_sessions WHERE user_id = ?',
      [user.id]
    );
    
    // Calculate days active
    const daysActive = sessionStats[0].first_login 
      ? Math.floor((Date.now() - new Date(sessionStats[0].first_login).getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    
    res.json({
      user: user,
      stats: {
        totalSessions: sessionStats[0].total_sessions,
        daysActive: daysActive,
        profileViews: Math.floor(Math.random() * 150) + 30 // Simulated for demo
      }
    });
    
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (conn) conn.release();
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Check authentication status
app.get('/api/auth-status', (req, res) => {
  if (req.session && req.session.userId) {
    res.json({ authenticated: true, userId: req.session.userId });
  } else {
    res.json({ authenticated: false });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Initialize database and start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access the application at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await pool.end();
  process.exit(0);
});