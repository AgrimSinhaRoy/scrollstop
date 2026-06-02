const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');

// Load persisted submissions on startup
let surveySubmissions = [];
try {
  if (fs.existsSync(SUBMISSIONS_FILE)) {
    surveySubmissions = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8'));
  }
} catch (e) {
  console.warn('Could not load submissions.json:', e.message);
}

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(session({
  secret: 'scrollstop-secret',
  resave: false,
  saveUninitialized: true
}));

// In-memory data store (replace with a DB later)
let goals = [
  { id: 1, platform: 'Instagram', limitMinutes: 30, color: '#e1306c' },
  { id: 2, platform: 'YouTube', limitMinutes: 60, color: '#ff0000' },
  { id: 3, platform: 'TikTok', limitMinutes: 20, color: '#010101' }
];

let sessions = [
  { id: 1, platform: 'Instagram', minutes: 45, date: '2026-05-30' },
  { id: 2, platform: 'YouTube', minutes: 55, date: '2026-05-30' },
  { id: 3, platform: 'TikTok', minutes: 10, date: '2026-05-30' },
  { id: 4, platform: 'Instagram', minutes: 20, date: '2026-05-31' },
  { id: 5, platform: 'YouTube', minutes: 80, date: '2026-05-31' }
];

let nextGoalId = goals.length + 1;
let nextSessionId = sessions.length + 1;

// Helper: compute stats
function getStats() {
  const today = new Date().toISOString().split('T')[0];
  const todaySessions = sessions.filter(s => s.date === today);
  const totalToday = todaySessions.reduce((sum, s) => sum + s.minutes, 0);

  const platformTotals = {};
  sessions.forEach(s => {
    platformTotals[s.platform] = (platformTotals[s.platform] || 0) + s.minutes;
  });

  const goalStatus = goals.map(g => {
    const todayMinutes = todaySessions
      .filter(s => s.platform === g.platform)
      .reduce((sum, s) => sum + s.minutes, 0);
    return {
      ...g,
      todayMinutes,
      overLimit: todayMinutes > g.limitMinutes,
      percentage: Math.min(Math.round((todayMinutes / g.limitMinutes) * 100), 100)
    };
  });

  return { totalToday, goalStatus, platformTotals };
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'scrollstop2.html'));
});

app.post('/survey/submit', (req, res) => {
  const submission = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    ...req.body
  };
  surveySubmissions.push(submission);
  // Persist to file
  try { fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(surveySubmissions, null, 2)); } catch (e) {}
  res.json({ success: true, id: submission.id });
});

app.get('/api/leaderboard', (req, res) => {
  const entries = surveySubmissions
    .filter(s => s.fsi != null)
    .map(s => ({
      id: s.id,
      displayName: s.isAnonymous || !s.participantName ? 'Anonymous' : s.participantName,
      grade: s.grade || null,
      school: s.school || null,
      fsi: parseInt(s.fsi) || 0,
      timestamp: s.timestamp
    }))
    .sort((a, b) => b.fsi - a.fsi)
    .slice(0, 50);
  res.json(entries);
});

app.get('/dashboard', (req, res) => {
  const stats = getStats();
  res.render('index', { title: 'ScrollStop', stats });
});

app.get('/goals', (req, res) => {
  res.render('goals', { title: 'My Goals', goals });
});

app.post('/goals', (req, res) => {
  const { platform, limitMinutes, color } = req.body;
  goals.push({ id: nextGoalId++, platform, limitMinutes: parseInt(limitMinutes), color });
  res.redirect('/goals');
});

app.delete('/goals/:id', (req, res) => {
  goals = goals.filter(g => g.id !== parseInt(req.params.id));
  res.redirect('/goals');
});

app.get('/log', (req, res) => {
  const sorted = [...sessions].sort((a, b) => new Date(b.date) - new Date(a.date));
  res.render('log', { title: 'Session Log', sessions: sorted, goals });
});

app.post('/log', (req, res) => {
  const { platform, minutes, date } = req.body;
  sessions.push({ id: nextSessionId++, platform, minutes: parseInt(minutes), date });
  res.redirect('/log');
});

app.delete('/log/:id', (req, res) => {
  sessions = sessions.filter(s => s.id !== parseInt(req.params.id));
  res.redirect('/log');
});

app.get('/insights', (req, res) => {
  const stats = getStats();
  const platformTotals = stats.platformTotals;
  res.render('insights', { title: 'Insights', platformTotals, sessions, goals });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('404', { title: 'Page Not Found' });
});

app.listen(PORT, () => {
  console.log(`ScrollStop running at http://localhost:${PORT}`);
});
