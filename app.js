require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const methodOverride = require('method-override');
const path = require('path');
const bcrypt = require('bcrypt');
const multer = require('multer');
const crypto = require('crypto');
const mongoose = require('mongoose');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// ── MongoDB connection ────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI || MONGODB_URI.includes('<user>')) {
  console.error('ERROR: Set MONGODB_URI in your .env file before starting.');
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.error('ERROR: Set SESSION_SECRET in your .env file before starting.');
  process.exit(1);
}
mongoose.connect(MONGODB_URI).then(() => {
  console.log('✓ Connected to MongoDB Atlas');
}).catch(err => {
  console.error('MongoDB connection error:', err.message);
  process.exit(1);
});

async function ensureAdminAccount() {
  try {
    const existing = await User.findOne({ username: { $regex: /^admin$/i } });
    if (existing) {
      if (!existing.isAdmin) {
        await User.updateOne({ username: { $regex: /^admin$/i } }, { $set: { isAdmin: true } });
        console.log('✓ Admin privileges granted to existing admin account');
      } else {
        console.log('✓ Admin account already exists');
      }
      return;
    }
    const hash = await bcrypt.hash('Imagrim@123', 12);
    await User.create({
      id: Date.now(), username: 'admin', passwordHash: hash,
      dob: '2000-01-01', createdAt: new Date().toISOString(),
      isAdmin: true, banned: false, xp: 0, streak: 0,
      level: 1, levelName: 'Dormant', lastLogDate: null, avatar: null
    });
    console.log('✓ Admin account created — username: admin, password: Imagrim@123');
  } catch(e) {
    console.error('Admin setup error:', e.message);
  }
}

mongoose.connection.once('open', () => { ensureAdminAccount(); });

// ── Mongoose Schemas ─────────────────────────────────────────
const userSchema = new mongoose.Schema({
  id:           { type: Number, required: true, unique: true }, // kept for session compat
  username:     { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  dob:          String,
  createdAt:    String,
  isAdmin:      { type: Boolean, default: false },
  banned:       { type: Boolean, default: false },
  xp:           { type: Number, default: 0 },
  streak:       { type: Number, default: 0 },
  level:        { type: Number, default: 1 },
  levelName:    { type: String, default: 'Dormant' },
  lastLogDate:  String,
  avatar:       String,
}, { versionKey: false });

const submissionSchema = new mongoose.Schema({
  id:              Number,
  timestamp:       String,
  userId:          Number,
  username:        String,
  participantName: String,
  isAnonymous:     mongoose.Schema.Types.Mixed,
  grade:           String,
  school:          String,
  country:         String,
  passiveHours:    mongoose.Schema.Types.Mixed,
  activeHours:     mongoose.Schema.Types.Mixed,
  sleepHours:      mongoose.Schema.Types.Mixed,
  mood:            mongoose.Schema.Types.Mixed,
  focus:           mongoose.Schema.Types.Mixed,
  academicScore:   mongoose.Schema.Types.Mixed,
  fsi:             mongoose.Schema.Types.Mixed,
  xp:              mongoose.Schema.Types.Mixed,
  streak:          mongoose.Schema.Types.Mixed,
  level:           mongoose.Schema.Types.Mixed,
  levelName:       String,
  lastLogDate:     String,
  savedAt:         mongoose.Schema.Types.Mixed,
  studyHours:      mongoose.Schema.Types.Mixed,
  phoneChecks:     mongoose.Schema.Types.Mixed,
  challengeToken:  String,
}, { versionKey: false });

const challengeSchema = new mongoose.Schema({
  token:         { type: String, required: true, unique: true },
  challengerId:  Number,
  challengerName: String,
  challengerFSI: Number,
  createdAt:     String,
  expiresAt:     String,
  responses:     [{ responderName: String, fsi: Number, respondedAt: String }],
  category:      { type: String, default: 'fsi' },
}, { versionKey: false });

const User       = mongoose.model('User',       userSchema);
const Submission = mongoose.model('Submission', submissionSchema);
const Challenge  = mongoose.model('Challenge',  challengeSchema);

// ── Multer avatar upload ──────────────────────────────────────
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/avatars')),
  filename:    (req, file, cb) => cb(null, req.session.userId + path.extname(file.originalname))
});
const upload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images only'));
  }
});

// ── XP Level system ──────────────────────────────────────────
const LEVELS = [
  { level: 1,  name: 'Dormant',          min: 0    },
  { level: 2,  name: 'Awakening',        min: 100  },
  { level: 3,  name: 'Aware',            min: 250  },
  { level: 4,  name: 'Focused',          min: 450  },
  { level: 5,  name: 'Disciplined',      min: 700  },
  { level: 6,  name: 'Sharp',            min: 1000 },
  { level: 7,  name: 'Elite',            min: 1350 },
  { level: 8,  name: 'Sovereign',        min: 1750 },
  { level: 9,  name: 'Transcendent',     min: 2200 },
  { level: 10, name: 'ScrollBye Legend', min: 2700 },
];
function getLevelInfo(xp) {
  let info = LEVELS[0];
  for (const l of LEVELS) { if (xp >= l.min) info = l; }
  const nextLevel = LEVELS.find(l => l.min > xp);
  return { ...info, nextMin: nextLevel ? nextLevel.min : null };
}

const app = express();
const PORT = process.env.PORT || 3000;

// ── View engine ───────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Middleware ────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '50kb' }));
app.use(methodOverride('_method'));

// ── Security headers ──────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // disabled to avoid breaking inline scripts in HTML files
  crossOriginEmbedderPolicy: false,
}));

// ── Rate limiting ──────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { ok: false, error: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const surveyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { ok: false, error: 'Too many submissions. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(session({
  store: MongoStore.create({ mongoUrl: MONGODB_URI, dbName: 'scrollbye_dev', ttl: 86400 }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  }
}));

// ── In-memory legacy data (goals/sessions views — not critical) ─
let goals = [
  { id: 1, platform: 'Instagram', limitMinutes: 30, color: '#e1306c' },
  { id: 2, platform: 'YouTube',   limitMinutes: 60, color: '#ff0000' },
  { id: 3, platform: 'TikTok',    limitMinutes: 20, color: '#010101' }
];
let legacySessions = [
  { id: 1, platform: 'Instagram', minutes: 45, date: '2026-05-30' },
  { id: 2, platform: 'YouTube',   minutes: 55, date: '2026-05-30' },
  { id: 3, platform: 'TikTok',    minutes: 10, date: '2026-05-30' },
];
let nextGoalId = goals.length + 1;
let nextSessionId = legacySessions.length + 1;

function getStats() {
  const today = new Date().toISOString().split('T')[0];
  const todaySessions = legacySessions.filter(s => s.date === today);
  const totalToday = todaySessions.reduce((sum, s) => sum + s.minutes, 0);
  const platformTotals = {};
  legacySessions.forEach(s => { platformTotals[s.platform] = (platformTotals[s.platform] || 0) + s.minutes; });
  const goalStatus = goals.map(g => {
    const todayMinutes = todaySessions.filter(s => s.platform === g.platform).reduce((sum, s) => sum + s.minutes, 0);
    return { ...g, todayMinutes, overLimit: todayMinutes > g.limitMinutes, percentage: Math.min(Math.round((todayMinutes / g.limitMinutes) * 100), 100) };
  });
  return { totalToday, goalStatus, platformTotals };
}

// ── Admin middleware ──────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  User.findOne({ id: req.session.userId }).then(u => {
    if (!u || !u.isAdmin) return res.status(403).json({ error: 'Forbidden' });
    next();
  }).catch(() => res.status(500).json({ error: 'Server error' }));
}

// ─────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'home.html'));
});
app.get('/survey', async (req, res) => {
  if (req.session.userId) {
    try {
      const user = await User.findOne({ id: req.session.userId });
      if (user && user.lastLogDate) {
        const challengeParam = req.query.challenge ? '?challenge=' + encodeURIComponent(req.query.challenge) : '';
        return res.redirect('/log-today' + challengeParam);
      }
    } catch(e) {}
  }
  res.sendFile(path.join(__dirname, 'scrollstop2.html'));
});
app.get('/results', (req, res) => res.sendFile(path.join(__dirname, 'results.html')));
app.get('/log-today', (req, res) => {
  if (!req.session.userId) return res.redirect('/login?next=/log-today');
  res.sendFile(path.join(__dirname, 'log-today.html'));
});
app.get('/login',    (req, res) => { if (req.session.userId) return res.redirect('/dashboard'); res.sendFile(path.join(__dirname, 'login.html')); });
app.get('/register', (req, res) => { if (req.session.userId) return res.redirect('/dashboard'); res.sendFile(path.join(__dirname, 'login.html')); });
app.get('/403', (req, res) => res.status(403).sendFile(path.join(__dirname, '403.html')));
app.get('/dashboard', (req, res) => { if (!req.session.userId) return res.redirect('/login?next=/dashboard'); res.sendFile(path.join(__dirname, 'dashboard.html')); });
app.get('/profile',   (req, res) => { if (!req.session.userId) return res.redirect('/login?next=/profile');   res.sendFile(path.join(__dirname, 'profile.html')); });
app.get('/challenges', (req, res) => { if (!req.session.userId) return res.redirect('/login?next=/challenges'); res.sendFile(path.join(__dirname, 'challenges.html')); });
app.get('/admin', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login?next=/admin');
  const user = await User.findOne({ id: req.session.userId });
  if (!user || !user.isAdmin) return res.status(403).sendFile(path.join(__dirname, '403.html'));
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ── GET /api/me ───────────────────────────────────────────────
app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const user = await User.findOne({ id: req.session.userId });
  if (!user) { req.session.destroy(); return res.json({ loggedIn: false }); }
  const newUser = !!req.session.newUser;
  if (req.session.newUser) delete req.session.newUser;
  res.json({ loggedIn: true, username: user.username, avatar: user.avatar || null, isAdmin: user.isAdmin || false, createdAt: user.createdAt || null, newUser });
});

// ── POST /auth/login ──────────────────────────────────────────
app.post('/auth/login', authLimiter, async (req, res) => {
  const identifier = String(req.body.identifier || '').trim().slice(0, 60);
  const password   = String(req.body.password   || '');
  if (!identifier || !password) return res.json({ ok: false, error: 'Please fill in all fields.' });
  const user = await User.findOne({ username: { $regex: new RegExp('^' + identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } });
  if (!user) return res.json({ ok: false, error: 'Invalid username or password.' });
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.json({ ok: false, error: 'Invalid username or password.' });
  if (user.banned) return res.json({ ok: false, error: 'This account has been suspended.' });
  const maxAge = req.body.remember ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  // Regenerate session ID to prevent session fixation attacks
  req.session.regenerate(function(err) {
    if (err) return res.json({ ok: false, error: 'Session error. Please try again.' });
    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.cookie.maxAge = maxAge;
    req.session.save(function(saveErr) {
      if (saveErr) return res.json({ ok: false, error: 'Session error. Please try again.' });
      res.json({ ok: true, redirect: '/' });
    });
  });
});

// ── POST /auth/register ───────────────────────────────────────
app.post('/auth/register', authLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const dob      = String(req.body.dob      || '');
  if (!username || username.length < 3)  return res.json({ ok: false, error: 'Username must be at least 3 characters.' });
  if (username.length > 30)              return res.json({ ok: false, error: 'Username must be 30 characters or fewer.' });
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) return res.json({ ok: false, error: 'Username can only contain letters, numbers, underscores, hyphens, and dots.' });
  if (password.length < 8)               return res.json({ ok: false, error: 'Password must be at least 8 characters.' });
  if (!dob)                              return res.json({ ok: false, error: 'Date of birth is required.' });
  const exists = await User.findOne({ username: { $regex: new RegExp('^' + username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } });
  if (exists) return res.json({ ok: false, error: 'That username is already taken.' });
  const hash = await bcrypt.hash(password, 12);
  const user = await User.create({ id: Date.now(), username, passwordHash: hash, dob, createdAt: new Date().toISOString() });
  // Regenerate session ID to prevent session fixation attacks
  req.session.regenerate(function(err) {
    if (err) return res.json({ ok: false, error: 'Session error. Please try again.' });
    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.save(function(saveErr) {
      if (saveErr) return res.json({ ok: false, error: 'Session error. Please try again.' });
      res.json({ ok: true, redirect: '/' });
    });
  });
});

// ── GET /auth/logout ──────────────────────────────────────────
app.get('/auth/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });

// ── POST /survey/submit ───────────────────────────────────────
const SURVEY_FIELDS = ['participantName','isAnonymous','grade','school','country',
  'passiveHours','activeHours','sleepHours','mood','focus','focusQuality','academicScore','academicPerformance',
  'fsi','xp','streak','level','levelName','lastLogDate','savedAt',
  'studyHours','phoneChecks',
  'screenScore','sleepScore','moodScore','focusScore'];

app.post('/survey/submit', surveyLimiter, async (req, res) => {
  const safe = {};
  SURVEY_FIELDS.forEach(k => { if (req.body[k] !== undefined) safe[k] = req.body[k]; });
  const doc = { id: Date.now(), timestamp: new Date().toISOString(), userId: req.session.userId || null, username: req.session.username || null, ...safe };
  if (req.session.userId) {
    const user = await User.findOne({ id: req.session.userId });
    if (user) { doc.userId = user.id; doc.username = user.username; }
  }
  const sub = await Submission.create(doc);

  // Auto-compute XP / streak / level for logged-in users (server-authoritative)
  if (doc.userId) {
    try {
      const user = await User.findOne({ id: doc.userId });
      if (user) {
        const today     = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const isNewDay  = user.lastLogDate !== today;
        if (isNewDay) {
          const newStreak = user.lastLogDate === yesterday ? (user.streak || 0) + 1 : 1;
          let earned = 50; // base daily XP
          // FSI improvement vs previous submission
          const prevSub = await Submission.findOne({ userId: doc.userId, _id: { $ne: sub._id } }).sort({ timestamp: -1 });
          if (prevSub && prevSub.fsi != null) {
            const imp = (parseFloat(doc.fsi) || 0) - (parseFloat(prevSub.fsi) || 0);
            if (imp > 0) earned += Math.min(Math.round(imp), 50);
          }
          // FSI tier bonus
          const fsi = parseFloat(doc.fsi) || 0;
          if (fsi >= 75) earned += 25; else if (fsi >= 50) earned += 10;
          // Sleep target (7–9 h)
          const sl = parseFloat(doc.sleepHours) || 0;
          if (sl >= 7 && sl <= 9) earned += 20;
          // Phone checks reduction
          const ch = parseInt(doc.phoneChecks) || 0;
          if (ch === 0) earned += 30; else if (ch <= 2) earned += 15; else if (ch <= 4) earned += 5;
          // Streak bonus
          earned += Math.min(newStreak * 5, 50);
          const newXp = (user.xp || 0) + earned;
          const li = getLevelInfo(newXp);
          await User.updateOne({ id: doc.userId }, { $set: { xp: newXp, streak: newStreak, level: li.level, levelName: li.name, lastLogDate: today } });
        }
      }
    } catch (e) { console.error('XP auto-compute error:', e.message); }
  }

  res.json({ success: true, id: sub.id });

  // Non-blocking: auto-post challenge response if token provided
  (async () => {
    const ct = (req.body.challengeToken || '').toString().trim();
    if (!ct) return;
    try {
      const c = await Challenge.findOne({ token: ct });
      if (!c || new Date() > new Date(c.expiresAt)) return;
      const responderName = ((req.body.responderName || req.body.participantName || 'Anonymous')).toString().slice(0, 40);
      const fsi = parseFloat(doc.fsi);
      if (isNaN(fsi)) return;
      await Challenge.updateOne({ token: ct }, { $push: { responses: { responderName, fsi, respondedAt: new Date().toISOString() } } });
      // Store token on submission so responder can find their result later
      await Submission.updateOne({ id: sub.id }, { $set: { challengeToken: ct } });
    } catch (e) { console.error('Challenge auto-post error:', e.message); }
  })();
});

// ── POST /api/claim-submission ───────────────────────────────
// Links an anonymous submission to the logged-in user and grants XP
app.post('/api/claim-submission', async (req, res) => {
  if (!req.session.userId) return res.json({ ok: false, error: 'Not logged in' });
  const subId = parseInt(req.body.submissionId);
  if (!subId) return res.json({ ok: false, error: 'No submission ID' });
  const sub = await Submission.findOne({ id: subId });
  if (!sub) return res.json({ ok: false, error: 'Not found' });
  if (sub.userId) return res.json({ ok: false, error: 'Already claimed' });
  const user = await User.findOne({ id: req.session.userId });
  if (!user) return res.json({ ok: false });
  await Submission.updateOne({ id: subId }, { $set: { userId: user.id, username: user.username } });
  // Grant XP (same logic as /survey/submit)
  try {
    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (user.lastLogDate !== today) {
      const newStreak = user.lastLogDate === yesterday ? (user.streak || 0) + 1 : 1;
      let earned = 50;
      const prevSub = await Submission.findOne({ userId: user.id, _id: { $ne: sub._id } }).sort({ timestamp: -1 });
      if (prevSub && prevSub.fsi != null) {
        const imp = (parseFloat(sub.fsi) || 0) - (parseFloat(prevSub.fsi) || 0);
        if (imp > 0) earned += Math.min(Math.round(imp), 50);
      }
      const fsi = parseFloat(sub.fsi) || 0;
      if (fsi >= 75) earned += 25; else if (fsi >= 50) earned += 10;
      const sl = parseFloat(sub.sleepHours) || 0;
      if (sl >= 7 && sl <= 9) earned += 20;
      const ch = parseInt(sub.phoneChecks) || 0;
      if (ch === 0) earned += 30; else if (ch <= 2) earned += 15; else if (ch <= 4) earned += 5;
      earned += Math.min(newStreak * 5, 50);
      const newXp = (user.xp || 0) + earned;
      const li = getLevelInfo(newXp);
      await User.updateOne({ id: user.id }, { $set: { xp: newXp, streak: newStreak, level: li.level, levelName: li.name, lastLogDate: today } });
    }
  } catch (e) { console.error('Claim XP error:', e.message); }
  res.json({ ok: true });
});

// ── POST /api/save-progress ───────────────────────────────────
const MAX_XP_PER_DAY = 500;
app.post('/api/save-progress', async (req, res) => {
  if (!req.session.userId) return res.json({ ok: false, error: 'Not logged in' });
  const user = await User.findOne({ id: req.session.userId });
  if (!user) return res.json({ ok: false, error: 'User not found' });
  const { xp, streak, level, levelName, lastLogDate } = req.body;
  const update = {};
  if (xp         !== undefined) update.xp          = Math.min(parseInt(xp) || 0, (user.xp || 0) + MAX_XP_PER_DAY);
  if (streak     !== undefined) update.streak       = Math.min(parseInt(streak) || 0, 366);
  if (level      !== undefined) update.level        = Math.min(Math.max(parseInt(level) || 1, 1), 10);
  if (levelName  !== undefined) update.levelName    = String(levelName).slice(0, 40);
  if (lastLogDate !== undefined) update.lastLogDate = String(lastLogDate).slice(0, 10);
  await User.updateOne({ id: req.session.userId }, { $set: update });
  res.json({ ok: true });
});

// ── GET /api/my-submissions ───────────────────────────────────
app.get('/api/my-submissions', async (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false, submissions: [] });
  const subs = await Submission.find({ userId: req.session.userId })
    .sort({ timestamp: -1 }).limit(30).lean();
  const formatted = subs.map(s => ({
    date:     s.timestamp ? s.timestamp.slice(0, 10) : '',
    fsi:      parseFloat(s.fsi)            || 0,
    passive:  parseFloat(s.passiveHours)   || 0,
    active:   parseFloat(s.activeHours)    || 0,
    sleep:    parseFloat(s.sleepHours)     || 0,
    mood:     parseInt(s.mood)             || 3,
    focus:    parseInt(s.focus || s.focusQuality) || 3,
    academic: parseInt(s.academicPerformance)      || 6,
    checks:   parseInt(s.phoneChecks)      || 0,
    study:    parseFloat(s.studyHours)     || 0,
    timestamp: s.timestamp
  })).sort((a, b) => a.date < b.date ? -1 : 1);
  res.json({ loggedIn: true, submissions: formatted });
});

// ── GET /api/my-progress ──────────────────────────────────────
app.get('/api/my-progress', async (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const user = await User.findOne({ id: req.session.userId });
  if (!user) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, xp: user.xp || 0, streak: user.streak || 0, level: user.level || 1, levelName: user.levelName || 'Dormant', lastLogDate: user.lastLogDate || null });
});

// ── GET /api/my-latest-submission ─────────────────────────────
app.get('/api/my-latest-submission', async (req, res) => {
  if (!req.session.userId) return res.json({ ok: false, error: 'Not logged in' });

  const user = await User.findOne({ id: req.session.userId });
  if (!user) return res.json({ ok: false, error: 'User not found' });

  // Only match submissions that explicitly belong to this user
  // Never fall back to other users' data
  const sub = await Submission.findOne({
    $or: [
      { userId: req.session.userId },
      { userId: String(req.session.userId) },
      {
        username: {
          $regex: new RegExp('^' + user.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')
        },
        userId: { $exists: false }
      }
    ]
  }).sort({ timestamp: -1 });

  // If still no match — return noData, NEVER return another user's submission
  if (!sub) return res.json({ ok: false, noData: true });

  res.json({ ok: true, submission: sub });
});

// ── GET /api/leaderboard ──────────────────────────────────────
app.get('/api/leaderboard', async (req, res) => {
  // Fetch all submissions that belong to a registered user and have an FSI
  const subs = await Submission.find({ userId: { $exists: true, $ne: null }, fsi: { $ne: null, $exists: true } })
    .sort({ timestamp: -1 }).lean();

  // Group by userId, accumulate FSI scores and keep latest metadata
  const userMap = new Map();
  for (const s of subs) {
    const key = String(s.userId);
    if (!userMap.has(key)) {
      userMap.set(key, { userId: s.userId, fsiList: [], grade: s.grade || null, school: s.school || null, username: s.username });
    }
    const entry = userMap.get(key);
    entry.fsiList.push(parseFloat(s.fsi) || 0);
    // latest metadata (first one seen because we sorted desc)
    if (!entry.grade && s.grade) entry.grade = s.grade;
    if (!entry.school && s.school) entry.school = s.school;
  }

  const entries = [];
  for (const [, data] of userMap) {
    const u = await User.findOne({ id: data.userId });
    if (!u) continue;
    const avg = data.fsiList.reduce((a, b) => a + b, 0) / data.fsiList.length;
    entries.push({
      displayName: u.username,
      grade: data.grade,
      school: data.school,
      fsi: Math.round(avg * 10) / 10,
      days: data.fsiList.length
    });
  }

  entries.sort((a, b) => b.fsi - a.fsi);
  res.json(entries.slice(0, 50));
});

// ── GET /api/xp-leaderboard ───────────────────────────────────
app.get('/api/xp-leaderboard', async (req, res) => {
  const registeredUsers = await User.find({}).sort({ xp: -1 }).limit(50);
  const entries = [];
  for (const u of registeredUsers) {
    const latestSub = await Submission.findOne({ userId: u.id, fsi: { $ne: null } }).sort({ timestamp: -1 });
    entries.push({ id: u.id, displayName: u.username, fsi: latestSub ? (parseInt(latestSub.fsi) || 0) : 0, xp: u.xp || 0, streak: u.streak || 0, level: u.level || 1, levelName: u.levelName || 'Dormant', isRegistered: true });
  }
  const combined = [...entries].sort((a, b) => b.xp - a.xp || b.fsi - a.fsi).slice(0, 50);
  res.json(combined);
});

// ── POST /api/upload-avatar ───────────────────────────────────
app.post('/api/upload-avatar', (req, res) => {
  if (!req.session.userId) return res.json({ ok: false, error: 'Not logged in' });
  upload.single('avatar')(req, res, async (err) => {
    if (err) return res.json({ ok: false, error: err.message });
    if (!req.file) return res.json({ ok: false, error: 'Upload failed' });
    const avatarPath = '/avatars/' + req.file.filename;
    await User.updateOne({ id: req.session.userId }, { $set: { avatar: avatarPath } });
    res.json({ ok: true, avatar: avatarPath });
  });
});

// ── GET /api/admin/stats ──────────────────────────────────────
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const totalUsers = await User.countDocuments();
  const totalSubs  = await Submission.countDocuments();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const activeUsers = await User.countDocuments({ lastLogDate: { $gte: sevenDaysAgo } });
  const bannedUsers = await User.countDocuments({ banned: true });
  const fsiAgg = await Submission.aggregate([{ $match: { fsi: { $ne: null, $exists: true } } }, { $group: { _id: null, avg: { $avg: { $toDouble: '$fsi' } } } }]);
  const passAgg = await Submission.aggregate([{ $match: { passiveHours: { $ne: null, $exists: true } } }, { $group: { _id: null, avg: { $avg: { $toDouble: '$passiveHours' } } } }]);
  const actAgg  = await Submission.aggregate([{ $match: { activeHours:  { $ne: null, $exists: true } } }, { $group: { _id: null, avg: { $avg: { $toDouble: '$activeHours'  } } } }]);
  const countryAgg = await Submission.aggregate([{ $group: { _id: { $ifNull: ['$country','Unknown'] }, count: { $sum: 1 } } }]);
  const gradeAgg   = await Submission.aggregate([{ $group: { _id: { $ifNull: ['$grade','Unknown']  }, count: { $sum: 1 } } }]);
  const schoolAgg  = await Submission.aggregate([{ $match: { school: { $exists: true, $ne: null } } }, { $group: { _id: '$school', count: { $sum: 1 } } }]);
  const recentSubs = await Submission.find({}).sort({ timestamp: -1 }).limit(10);
  const toMap = arr => Object.fromEntries(arr.map(e => [e._id, e.count]));
  res.json({
    totalUsers, totalSubmissions: totalSubs, activeUsers, bannedUsers,
    avgFSI:     fsiAgg[0]  ? Math.round(fsiAgg[0].avg)   : null,
    avgPassive: passAgg[0] ? Math.round(passAgg[0].avg * 10) / 10 : null,
    avgActive:  actAgg[0]  ? Math.round(actAgg[0].avg  * 10) / 10 : null,
    countryBreakdown: toMap(countryAgg),
    gradeBreakdown:   toMap(gradeAgg),
    schoolBreakdown:  toMap(schoolAgg),
    recentSubmissions: recentSubs,
  });
});

// ── GET /api/admin/users ──────────────────────────────────────
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const all = await User.find({}, { passwordHash: 0 }).lean();
  res.json(all);
});

// ── DELETE /api/admin/user/:id ────────────────────────────────
app.delete('/api/admin/user/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.session.userId) return res.status(400).json({ error: 'Cannot delete your own account' });
  const user = await User.findOne({ id });
  if (!user) return res.status(404).json({ error: 'User not found' });
  await User.deleteOne({ id });
  await Submission.deleteMany({ $or: [{ userId: id }, { userId: String(id) }, { username: user.username }] });
  await Challenge.deleteMany({ challengerId: id });
  await Challenge.updateMany({ 'responses.responderName': user.username }, { $pull: { responses: { responderName: user.username } } });
  console.log('Admin deleted user:', user.username, '— removed from all leaderboards and challenges');
  res.json({ ok: true, message: 'User and all associated data deleted successfully' });
});

// ── POST /api/admin/make-admin ────────────────────────────────
app.post('/api/admin/make-admin', requireAdmin, async (req, res) => {
  const id = parseInt(req.body.id);
  const result = await User.updateOne({ id }, { $set: { isAdmin: true } });
  if (result.matchedCount === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

// ── POST /api/admin/ban-user ──────────────────────────────────
app.post('/api/admin/ban-user', requireAdmin, async (req, res) => {
  const id = parseInt(req.body.id);
  if (id === req.session.userId) return res.status(400).json({ error: 'Cannot ban your own account' });
  const result = await User.updateOne({ id }, { $set: { banned: req.body.ban === true } });
  if (result.matchedCount === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true, banned: req.body.ban === true });
});

// ── POST /api/admin/clear-user-data/:id ─────────────────────
app.post('/api/admin/clear-user-data/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const user = await User.findOne({ id });
  if (!user) return res.status(404).json({ error: 'User not found' });
  await Submission.deleteMany({ $or: [{ userId: id }, { userId: String(id) }, { username: user.username }] });
  await User.updateOne({ id }, { $set: { xp: 0, streak: 0, level: 1, levelName: 'Dormant', lastLogDate: null } });
  res.json({ ok: true, message: 'User data cleared from all leaderboards' });
});

// ── Challenge routes ──────────────────────────────────────────
app.get('/api/my-challenges', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ ok: false, error: 'Login required' });
  const created = await Challenge.find({ challengerId: req.session.userId }).sort({ createdAt: -1 }).limit(20);
  const respondedSubs = await Submission.find({ userId: req.session.userId, challengeToken: { $exists: true, $ne: null } }).lean();
  const responded = [];
  for (const sub of respondedSubs) {
    const c = await Challenge.findOne({ token: sub.challengeToken });
    if (c) responded.push({ challenge: c, myFsi: sub.fsi, respondedAt: sub.timestamp });
  }
  res.json({ ok: true, created, responded });
});

app.get('/api/my-badge-data', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ ok: false });
  try {
    const challengesCreated = await Challenge.countDocuments({ challengerId: req.session.userId });
    const respondedSubs = await Submission.find({ userId: req.session.userId, challengeToken: { $exists: true, $ne: null } }).sort({ timestamp: 1 }).lean();
    let challengesWon = 0, consecutiveWins = 0, currentStreak = 0;
    for (const sub of respondedSubs) {
      const ch = await Challenge.findOne({ token: sub.challengeToken }).lean();
      if (ch) {
        const myFsi = parseFloat(sub.fsi) || 0;
        const theirFsi = parseFloat(ch.challengerFSI) || 0;
        if (myFsi > theirFsi) { challengesWon++; currentStreak++; if (currentStreak > consecutiveWins) consecutiveWins = currentStreak; }
        else { currentStreak = 0; }
      }
    }
    const top10 = await User.find({}).sort({ xp: -1 }).limit(10).lean();
    const isTop10 = top10.some(u => u.username === req.session.username);
    res.json({ ok: true, challengesCreated, challengesWon, consecutiveWins, isTop10, socialShares: 0 });
  } catch(e) {
    res.json({ ok: false, challengesCreated: 0, challengesWon: 0, consecutiveWins: 0, isTop10: false, socialShares: 0 });
  }
});

app.post('/api/challenge/create-vs', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ ok: false, error: 'Login required' });
  const validCategories = ['sleep','focus','passive','streak','fsi','speed'];
  const category = (req.body.category || 'fsi').toString();
  if (!validCategories.includes(category)) return res.status(400).json({ ok: false, error: 'Invalid category' });
  const challengerScore = parseFloat(req.body.challengerScore);
  if (isNaN(challengerScore)) return res.status(400).json({ ok: false, error: 'Invalid score' });
  const challengerName = (req.body.challengerName || req.session.username || 'Anonymous').toString().slice(0, 40);
  const token = crypto.randomBytes(8).toString('hex');
  await Challenge.create({ token, challengerId: req.session.userId, challengerName, challengerFSI: challengerScore, category, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), responses: [] });
  res.json({ ok: true, token, link: req.protocol + '://' + req.get('host') + '/challenge/' + token });
});

app.post('/api/challenge/create', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ ok: false, error: 'Login required' });
  const fsi = parseFloat(req.body.fsi);
  if (isNaN(fsi) || fsi < 0 || fsi > 100) return res.status(400).json({ ok: false, error: 'Invalid FSI' });
  const challengerName = (req.body.challengerName || req.session.username || 'Anonymous').toString().slice(0, 40);
  const token = crypto.randomBytes(8).toString('hex');
  await Challenge.create({ token, challengerId: req.session.userId, challengerName, challengerFSI: fsi, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), responses: [] });
  res.json({ ok: true, token, link: req.protocol + '://' + req.get('host') + '/challenge/' + token });
});

app.get('/my-challenge/:token', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const c = await Challenge.findOne({ token: req.params.token });
  if (!c) return res.status(404).sendFile(path.join(__dirname, '403.html'));
  if (c.challengerId !== req.session.userId) return res.redirect('/challenge/' + req.params.token);
  res.sendFile(path.join(__dirname, 'my-challenge.html'));
});

app.get('/api/my-challenge/:token', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  const c = await Challenge.findOne({ token: req.params.token }).lean();
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.challengerId !== req.session.userId) return res.status(403).json({ error: 'Not your challenge' });
  const expired = new Date() > new Date(c.expiresAt);
  const daysLeft = expired ? 0 : Math.ceil((new Date(c.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
  res.json({
    ok: true,
    token: c.token,
    challengerFSI: c.challengerFSI,
    challengerName: c.challengerName,
    createdAt: c.createdAt,
    expiresAt: c.expiresAt,
    expired,
    daysLeft,
    responses: c.responses || [],
    link: (process.env.BASE_URL || (req.protocol + '://' + req.get('host'))) + '/challenge/' + c.token,
    wins: (c.responses || []).filter(r => r.fsi < c.challengerFSI).length,
    losses: (c.responses || []).filter(r => r.fsi > c.challengerFSI).length,
    ties: (c.responses || []).filter(r => r.fsi === c.challengerFSI).length
  });
});

app.get('/challenge/:token', async (req, res) => {
  const c = await Challenge.findOne({ token: req.params.token });
  if (!c) return res.status(404).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Challenge Not Found</title><style>body{background:#04050d;color:#aaa;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:1rem;}</style></head><body><h2 style="color:#fff">Challenge not found</h2><a href="/survey" style="color:#6C63FF">Take Your Own Survey →</a></body></html>`);
  res.sendFile(path.join(__dirname, 'challenge.html'));
});

app.get('/api/challenge/:token', async (req, res) => {
  const c = await Challenge.findOne({ token: req.params.token });
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json({ challengerName: c.challengerName, challengerFSI: c.challengerFSI, createdAt: c.createdAt, expired: new Date() > new Date(c.expiresAt), responses: c.responses });
});

app.post('/api/challenge/:token/respond', async (req, res) => {
  const c = await Challenge.findOne({ token: req.params.token });
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (new Date() > new Date(c.expiresAt)) return res.status(410).json({ error: 'Challenge expired' });
  const responderName = (req.body.responderName || 'Anonymous').toString().slice(0, 40);
  const fsi = parseFloat(req.body.fsi);
  if (isNaN(fsi) || fsi < 0 || fsi > 100) return res.status(400).json({ error: 'Invalid FSI' });
  await Challenge.updateOne({ token: req.params.token }, { $push: { responses: { responderName, fsi, respondedAt: new Date().toISOString() } } });
  res.json({ ok: true, challengerFSI: c.challengerFSI, responderFSI: fsi, won: fsi > c.challengerFSI, tied: fsi === c.challengerFSI });
});

// ── GET /api/my-latest-challenge ────────────────────────────
app.get('/api/my-latest-challenge', async (req, res) => {
  if (!req.session.userId) return res.json({ ok: false });
  // Case 1: user created a challenge
  const created = await Challenge.findOne({ challengerId: req.session.userId }).sort({ createdAt: -1 });
  if (created) return res.json({ ok: true, challenge: created, role: 'challenger' });
  // Case 2: user responded to a challenge (token stored on their submission)
  const sub = await Submission.findOne({ userId: req.session.userId, challengeToken: { $exists: true, $ne: null } }).sort({ timestamp: -1 }).lean();
  if (sub && sub.challengeToken) {
    const challenge = await Challenge.findOne({ token: sub.challengeToken });
    if (challenge) return res.json({ ok: true, challenge, role: 'responder', myFsi: parseFloat(sub.fsi) || 0 });
  }
  return res.json({ ok: false, none: true });
});

// ── Legacy EJS views (goals/log/insights) ────────────────────
app.get('/goals',  (req, res) => res.render('goals',    { title: 'My Goals',   goals }));
app.post('/goals', (req, res) => { const { platform, limitMinutes, color } = req.body; goals.push({ id: nextGoalId++, platform, limitMinutes: parseInt(limitMinutes), color }); res.redirect('/goals'); });
app.delete('/goals/:id', (req, res) => { goals = goals.filter(g => g.id !== parseInt(req.params.id)); res.redirect('/goals'); });
app.get('/log',  (req, res) => res.render('log', { title: 'Session Log', sessions: [...legacySessions].sort((a,b) => new Date(b.date)-new Date(a.date)), goals }));
app.post('/log', (req, res) => { const { platform, minutes, date } = req.body; legacySessions.push({ id: nextSessionId++, platform, minutes: parseInt(minutes), date }); res.redirect('/log'); });
app.delete('/log/:id', (req, res) => { legacySessions = legacySessions.filter(s => s.id !== parseInt(req.params.id)); res.redirect('/log'); });
app.get('/insights', (req, res) => { const stats = getStats(); res.render('insights', { title: 'Insights', platformTotals: stats.platformTotals, sessions: legacySessions, goals }); });

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => res.status(404).render('404', { title: 'Page Not Found' }));

app.listen(PORT, () => console.log(`ScrollStop running at http://localhost:${PORT}`));
