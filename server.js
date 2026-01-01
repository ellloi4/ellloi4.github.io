const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this';
const DB_PATH = path.join(__dirname, 'db.json');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// DB helpers
function ensureDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [] }, null, 2));
  }
}
function readDB() {
  ensureDB();
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    const initial = { users: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
}
function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// Simple leaderboard (by currency)
function getLeaderboard(db) {
  return (db.users || [])
    .map(u => ({ username: u.username, currency: (u.state && u.state.currency) || 0 }))
    .sort((a,b) => b.currency - a.currency)
    .slice(0, 50);
}

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const db = readDB();
    const usernameStr = String(username).trim();
    if (!usernameStr) return res.status(400).json({ error: 'invalid username' });
    if (db.users.find(u => u.username === usernameStr)) return res.status(400).json({ error: 'username taken' });
    const hash = await bcrypt.hash(password, 10);
    // initial state: small starting currency and starter block
    const initialState = {
      currency: 10,
      owned: { add1: 1 }, // owns one add1 block to begin
      sequence: [] // arranged program
    };
    db.users.push({ username: usernameStr, passwordHash: hash, state: initialState, createdAt: new Date().toISOString() });
    writeDB(db);
    res.json({ ok: true });
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'invalid credentials' });
    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, state: user.state });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Middleware
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' });
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// Get player state
app.get('/api/state', authMiddleware, (req, res) => {
  try {
    const db = readDB();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(400).json({ error: 'user not found' });
    res.json({ state: user.state, username: user.username });
  } catch (err) {
    console.error('state error', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Save player state
app.post('/api/save', authMiddleware, (req, res) => {
  try {
    const { state } = req.body || {};
    if (!state) return res.status(400).json({ error: 'state required' });
    const db = readDB();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(400).json({ error: 'user not found' });
    user.state = state;
    writeDB(db);
    res.json({ ok: true, leaderboard: getLeaderboard(db) });
  } catch (err) {
    console.error('save error', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Leaderboard (public)
app.get('/api/leaderboard', (req, res) => {
  try {
    const db = readDB();
    res.json({ leaderboard: getLeaderboard(db) });
  } catch (err) {
    console.error('leaderboard error', err);
    res.status(500).json({ error: 'server error' });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
