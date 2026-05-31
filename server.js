const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const webpush = require('web-push'); // Added background push package context

const app = express();
const PORT = process.env.PORT || 3000;

// Configure web-push keys derived directly from secure Railway context variables
webpush.setVapidDetails(
  'mailto:ibrahimantarr@gmail.com', // Operational validation signature mail
  process.env.BLmXKSzzax0C3iuhJJ5HvPJ54vYmj2PPdQbXHy1OZwixB62DealPJober-xd3n95OxqvpBQFBm9LLIsWaExx3Wk,
  process.env.xRiVttR8yXLvv2EqoebYHuq986xVZPDxAXH14E0fUEw
);

// In-memory array storage pool tracking device registration handset nodes
let pushSubscriptions = [];

// Ensure uploads directory exists
const UPLOADS_DIR = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ═══════════════════════════════════════════════════════════════
// DATABASE - PostgreSQL
// ═══════════════════════════════════════════════════════════════
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#f97316',
        pin TEXT NOT NULL DEFAULT '0000',
        disqualified INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS members (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        name TEXT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS completions (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL,
        task_num INTEGER NOT NULL,
        completed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(team_id, category_id, task_num)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        category_id TEXT NOT NULL,
        category_name TEXT NOT NULL,
        category_icon TEXT NOT NULL DEFAULT '📋',
        task_num INTEGER NOT NULL,
        task_name TEXT NOT NULL,
        evidence TEXT DEFAULT '',
        level TEXT DEFAULT 'Easy',
        points INTEGER DEFAULT 20,
        comment TEXT DEFAULT '',
        UNIQUE(category_id, task_num)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL,
        task_num INTEGER NOT NULL,
        note TEXT DEFAULT '',
        evidence_file TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMP,
        rejection_comment TEXT DEFAULT ''
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS advisors (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS advisor_teams (
        id SERIAL PRIMARY KEY,
        advisor_id INTEGER NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        UNIQUE(advisor_id, team_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        team_id INTEGER,
        icon TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    console.log('✅ Tables created');

    const teamCount = await client.query('SELECT COUNT(*) FROM teams');
    if (parseInt(teamCount.rows[0].count) === 0) {
      await seedDatabase(client);
    }
  } finally {
    client.release();
  }
}

async function seedDatabase(client) {
  await client.query("INSERT INTO activity_log (icon, message) VALUES ('🎉', 'Database ready! Import tasks from the Tools tab and create teams from the Manage tab.')");
  console.log('✅ Database ready (empty — import tasks via CSV)');
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
async function query(sql, params) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function queryOne(sql, params) {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

async function addLog(teamId, icon, message) {
  await pool.query('INSERT INTO activity_log (team_id, icon, message) VALUES ($1, $2, $3)', [teamId, icon, message]);
}

async function getTeamsFull() {
  const teams = await query('SELECT * FROM teams ORDER BY id');
  const members = await query('SELECT * FROM members ORDER BY id');
  const completions = await query('SELECT * FROM completions');

  return teams.map(t => ({
    id: t.id, name: t.name, color: t.color, pin: t.pin || '0000', disqualified: !!t.disqualified,
    members: members.filter(m => m.team_id === t.id).map(m => m.name),
    completions: completions.filter(c => c.team_id === t.id).map(c => ({ categoryId: c.category_id, taskNum: c.task_num }))
  }));
}

// ═══════════════════════════════════════════════════════════════
// ADMIN LOGIN
// ═══════════════════════════════════════════════════════════════
app.post('/api/admin/login', (req, res) => {
  try {
    const { password } = req.body;
    const adminPass = process.env.ADMIN_PASSWORD || 'ibrahim';
    if (password === adminPass) {
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Wrong password' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS REGISTER ENDPOINT
// ═══════════════════════════════════════════════════════════════
app.post('/api/notifications/subscribe', (req, res) => {
  const { teamId, subscription } = req.body;
  if (!teamId || !subscription) return res.status(400).json({ error: 'Missing fields' });

  // Filter out any stale/duplicate endpoint nodes to clean out redundancy memory
  pushSubscriptions = pushSubscriptions.filter(sub => sub.subscription.endpoint !== subscription.endpoint);
  
  pushSubscriptions.push({ teamId: parseInt(teamId), subscription });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════

app.get('/api/state', async (req, res) => {
  try {
    const teams = await getTeamsFull();
    const log = await query('SELECT * FROM activity_log ORDER BY id DESC LIMIT 200');
    const pending = await query("SELECT s.*, t.name as team_name, t.color as team_color FROM submissions s JOIN teams t ON s.team_id = t.id WHERE s.status = 'pending' ORDER BY s.submitted_at DESC");
    const reviewed = await query("SELECT s.*, t.name as team_name, t.color as team_color FROM submissions s JOIN teams t ON s.team_id = t.id WHERE s.status != 'pending' ORDER BY s.reviewed_at DESC LIMIT 100");
    res.json({ teams, log, submissions: { pending, reviewed } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Teams CRUD
app.post('/api/teams', async (req, res) => {
  try {
    const { name, color, members } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    if (!members || members.length < 1) return res.status(400).json({ error: 'Need at least 1 member' });
    if (members.length > 8) return res.status(400).json({ error: 'Max 8 members' });
    const result = await pool.query('INSERT INTO teams (name, color) VALUES ($1, $2) RETURNING id', [name, color || '#f97316']);
    const teamId = result.rows[0].id;
    for (const m of members) await pool.query('INSERT INTO members (team_id, name) VALUES ($1, $2)', [teamId, m]);
    await addLog(teamId, '🆕', 'Team "'+name+'" created');
    res.json({ success: true, teamId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/teams/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, color, members } = req.body;
    const team = await queryOne('SELECT * FROM teams WHERE id=$1', [id]);
    if (!team) return res.status(404).json({ error: 'Not found' });
    await pool.query('UPDATE teams SET name=$1, color=$2 WHERE id=$3', [name||team.name, color||team.color, id]);
    if (members && Array.isArray(members)) {
      await pool.query('DELETE FROM members WHERE team_id=$1', [id]);
      for (const m of members) await pool.query('INSERT INTO members (team_id, name) VALUES ($1, $2)', [id, m]);
    }
    await addLog(id, '✏️', 'Team "'+name+'" updated');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/teams/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const team = await queryOne('SELECT * FROM teams WHERE id=$1', [id]);
    if (!team) return res.status(404).json({ error: 'Not found' });
    await pool.query('DELETE FROM teams WHERE id=$1', [id]);
    await addLog(null, '🗑️', 'Team "'+team.name+'" deleted');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Members
app.post('/api/teams/:id/members', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const count = await queryOne('SELECT COUNT(*) as c FROM members WHERE team_id=$1', [id]);
    if (parseInt(count.c) >= 8) return res.status(400).json({ error: 'Max 8 members' });
    await pool.query('INSERT INTO members (team_id, name) VALUES ($1, $2)', [id, name]);
    const team = await queryOne('SELECT name FROM teams WHERE id=$1', [id]);
    await addLog(id, '👤', name+' joined '+team.name);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/teams/:teamId/members/:idx', async (req, res) => {
  try {
    const tid = parseInt(req.params.teamId);
    const idx = parseInt(req.params.idx);
    const members = await query('SELECT * FROM members WHERE team_id=$1 ORDER BY id', [tid]);
    if (members.length <= 1) return res.status(400).json({ error: 'Need at least 1 member' });
    const target = members[idx];
    if (!target) return res.status(404).json({ error: 'Not found' });
    await pool.query('DELETE FROM members WHERE id=$1', [target.id]);
    const team = await queryOne('SELECT name FROM teams WHERE id=$1', [tid]);
    await addLog(tid, '👤', target.name+' removed from '+team.name);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Disqualify
app.put('/api/teams/:id/disqualify', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const team = await queryOne('SELECT * FROM teams WHERE id=$1', [id]);
    if (!team) return res.status(404).json({ error: 'Not found' });
    const v = team.disqualified ? 0 : 1;
    await pool.query('UPDATE teams SET disqualified=$1 WHERE id=$2', [v, id]);
    await addLog(id, v?'🚫':'✅', team.name+(v?' DISQUALIFIED':' reinstated'));
    res.json({ success: true, disqualified: !!v });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Completions toggle
app.post('/api/completions/toggle', async (req, res) => {
  try {
    const { teamId, categoryId, taskNum } = req.body;
    const existing = await queryOne('SELECT * FROM completions WHERE team_id=$1 AND category_id=$2 AND task_num=$3', [teamId, categoryId, taskNum]);
    const team = await queryOne('SELECT name FROM teams WHERE id=$1', [teamId]);
    if (!team) return res.status(404).json({ error: 'Not found' });
    if (existing) {
      await pool.query('DELETE FROM completions WHERE team_id=$1 AND category_id=$2 AND task_num=$3', [teamId, categoryId, taskNum]);
      await addLog(teamId, '↩️', team.name+' unchecked '+categoryId+'-'+taskNum);
      res.json({ completed: false });
    } else {
      await pool.query('INSERT INTO completions (team_id, category_id, task_num) VALUES ($1, $2, $3)', [teamId, categoryId, taskNum]);
      await addLog(teamId, '✅', team.name+' completed '+categoryId+'-'+taskNum);
      res.json({ completed: true });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// SUBMISSIONS
app.post('/api/submissions', async (req, res) => {
  try {
    const { teamId, categoryId, taskNum, note, evidence, fileName, fileData } = req.body;
    if (!teamId || !categoryId || !taskNum) return res.status(400).json({ error: 'Missing fields' });
    const team = await queryOne('SELECT name FROM teams WHERE id=$1', [teamId]);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const pending = await queryOne("SELECT * FROM submissions WHERE team_id=$1 AND category_id=$2 AND task_num=$3 AND status='pending'", [teamId, categoryId, taskNum]);
    if (pending) return res.status(400).json({ error: 'Already have a pending submission' });
    const approved = await queryOne('SELECT * FROM completions WHERE team_id=$1 AND category_id=$2 AND task_num=$3', [teamId, categoryId, taskNum]);
    if (approved) return res.status(400).json({ error: 'Already approved' });

    const savedFiles = [];
    if (evidence && Array.isArray(evidence)) {
      for (const ev of evidence) {
        if (ev.data && ev.name) {
          const ext = path.extname(ev.name) || '.jpg';
          const savedName = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
          const base64 = ev.data.replace(/^data:.*?;base64,/, '');
          fs.writeFileSync(path.join(UPLOADS_DIR, savedName), Buffer.from(base64, 'base64'));
          savedFiles.push(savedName);
        }
      }
    } else if (fileData && fileName) {
      const ext = path.extname(fileName) || '.jpg';
      const savedName = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
      const base64 = fileData.replace(/^data:.*?;base64,/, '');
      fs.writeFileSync(path.join(UPLOADS_DIR, savedName), Buffer.from(base64, 'base64'));
      savedFiles.push(savedName);
    }

    const evidenceJson = JSON.stringify(savedFiles);
    await pool.query('INSERT INTO submissions (team_id, category_id, task_num, note, evidence_file) VALUES ($1, $2, $3, $4, $5)',
      [teamId, categoryId, taskNum, note || '', evidenceJson]);
    await addLog(teamId, '📨', team.name+' submitted '+categoryId+'-'+taskNum+' for review ('+savedFiles.length+' files)');
    res.json({ success: true, message: 'Submitted! Waiting for approval.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/submissions', async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const rows = await query("SELECT s.*, t.name as team_name, t.color as team_color FROM submissions s JOIN teams t ON s.team_id=t.id WHERE s.status=$1 ORDER BY s.submitted_at DESC", [status]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/submissions/:id/approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const sub = await queryOne('SELECT * FROM submissions WHERE id=$1', [id]);
    if (!sub) return res.status(404).json({ error: 'Not found' });
    if (sub.status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });
    await pool.query("UPDATE submissions SET status='approved', reviewed_at=NOW() WHERE id=$1", [id]);
    const existing = await queryOne('SELECT * FROM completions WHERE team_id=$1 AND category_id=$2 AND task_num=$3', [sub.team_id, sub.category_id, sub.task_num]);
    if (!existing) await pool.query('INSERT INTO completions (team_id, category_id, task_num) VALUES ($1, $2, $3)', [sub.team_id, sub.category_id, sub.task_num]);
    const team = await queryOne('SELECT name FROM teams WHERE id=$1', [sub.team_id]);
    await addLog(sub.team_id, '✅', team.name+' — '+sub.category_id+'-'+sub.task_num+' APPROVED');

    // ── TRIGGER REAL-TIME PUSH NOTIFICATION ON APPROVAL ──
    const approvedTeamDevices = pushSubscriptions.filter(device => device.teamId === sub.team_id);
    const approvalPayload = JSON.stringify({
      title: "🎯 Task Approved!",
      body: `Excellent! Your submission for Task #${sub.task_num} has been verified and marked approved!`,
      url: "/submit.html"
    });
    approvedTeamDevices.forEach(device => {
      webpush.sendNotification(device.subscription, approvalPayload).catch(() => {
        pushSubscriptions = pushSubscriptions.filter(s => s.subscription.endpoint !== device.subscription.endpoint);
      });
    });

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/submissions/:id/reject', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const sub = await queryOne('SELECT * FROM submissions WHERE id=$1', [id]);
    if (!sub) return res.status(404).json({ error: 'Not found' });
    if (sub.status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });
    const reason = req.body.reason || '';
    await pool.query("UPDATE submissions SET status='rejected', reviewed_at=NOW(), rejection_comment=$1 WHERE id=$2", [reason, id]);
    const team = await queryOne('SELECT name FROM teams WHERE id=$1', [sub.team_id]);
    await addLog(sub.team_id, '❌', team.name+' — '+sub.category_id+'-'+sub.task_num+' REJECTED'+(reason?': '+reason:''));

    // ── TRIGGER REAL-TIME PUSH NOTIFICATION ON REJECTION ──
    const rejectedTeamDevices = pushSubscriptions.filter(device => device.teamId === sub.team_id);
    const rejectionPayload = JSON.stringify({
      title: "❌ Revision Flagged",
      body: `Task #${sub.task_num} needs updates. Check comments to fix and retry!`,
      url: "/submit.html"
    });
    rejectedTeamDevices.forEach(device => {
      webpush.sendNotification(device.subscription, rejectionPayload).catch(() => {
        pushSubscriptions = pushSubscriptions.filter(s => s.subscription.endpoint !== device.subscription.endpoint);
      });
    });

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADVISORS
app.get('/api/advisors', async (req, res) => {
  try {
    const advisors = await query('SELECT * FROM advisors ORDER BY id');
    const links = await query('SELECT * FROM advisor_teams');
    res.json(advisors.map(a => ({
      id: a.id, username: a.username, name: a.name, active: !!a.active,
      teams: links.filter(l => l.advisor_id === a.id).map(l => l.team_id)
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/advisors', async (req, res) => {
  try {
    const { username, password, name, teams } = req.body;
    if (!username || !password || !name) return res.status(400).json({ error: 'All fields required' });
    if (!teams || teams.length < 1) return res.status(400).json({ error: 'Assign at least 1 team' });
    if (teams.length > 4) return res.status(400).json({ error: 'Max 4 teams' });
    const existing = await queryOne('SELECT * FROM advisors WHERE username=$1', [username]);
    if (existing) return res.status(400).json({ error: 'Username already exists' });
    const result = await pool.query('INSERT INTO advisors (username, password, name) VALUES ($1, $2, $3) RETURNING id', [username, password, name]);
    const aid = result.rows[0].id;
    for (const tid of teams) await pool.query('INSERT INTO advisor_teams (advisor_id, team_id) VALUES ($1, $2)', [aid, tid]);
    await addLog(null, '👤', 'Advisor "'+name+'" created');
    res.json({ success: true, advisorId: aid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/advisors/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { password, name, teams, active } = req.body;
    const advisor = await queryOne('SELECT * FROM advisors WHERE id=$1', [id]);
    if (!advisor) return res.status(404).json({ error: 'Not found' });
    if (password) await pool.query('UPDATE advisors SET password=$1 WHERE id=$2', [password, id]);
    if (name) await pool.query('UPDATE advisors SET name=$1 WHERE id=$2', [name, id]);
    if (active !== undefined) await pool.query('UPDATE advisors SET active=$1 WHERE id=$2', [active ? 1 : 0, id]);
    if (teams && Array.isArray(teams)) {
      if (teams.length > 4) return res.status(400).json({ error: 'Max 4 teams' });
      await pool.query('DELETE FROM advisor_teams WHERE advisor_id=$1', [id]);
      for (const tid of teams) await pool.query('INSERT INTO advisor_teams (advisor_id, team_id) VALUES ($1, $2)', [id, tid]);
    }
    await addLog(null, '✏️', 'Advisor "'+name+'" updated');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/advisors/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const advisor = await queryOne('SELECT * FROM advisors WHERE id=$1', [id]);
    if (!advisor) return res.status(404).json({ error: 'Not found' });
    await pool.query('DELETE FROM advisors WHERE id=$1', [id]);
    await addLog(null, '🗑️', 'Advisor "'+advisor.name+'" deleted');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Advisor login
app.post('/api/advisor/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const advisor = await queryOne('SELECT * FROM advisors WHERE username=$1 AND password=$2 AND active=1', [username, password]);
    if (!advisor) return res.status(401).json({ error: 'Invalid credentials' });
    const teamLinks = await query('SELECT team_id FROM advisor_teams WHERE advisor_id=$1', [advisor.id]);
    const teamIds = teamLinks.map(l => l.team_id);
    const allTeams = await getTeamsFull();
    const myTeams = allTeams.filter(t => teamIds.includes(t.id));
    res.json({ success: true, advisor: { id: advisor.id, name: advisor.name, username: advisor.username }, teams: myTeams });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/advisor/:id/state', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const advisor = await queryOne('SELECT * FROM advisors WHERE id=$1', [id]);
    if (!advisor) return res.status(404).json({ error: 'Not found' });
    const teamLinks = await query('SELECT team_id FROM advisor_teams WHERE advisor_id=$1', [id]);
    const teamIds = teamLinks.map(l => l.team_id);
    const allTeams = await getTeamsFull();
    const myTeams = allTeams.filter(t => teamIds.includes(t.id));
    const pending = teamIds.length ? await query("SELECT s.*, t.name as team_name, t.color as team_color FROM submissions s JOIN teams t ON s.team_id=t.id WHERE s.status='pending' AND s.team_id = ANY($1) ORDER BY s.submitted_at DESC", [teamIds]) : [];
    const reviewed = teamIds.length ? await query("SELECT s.*, t.name as team_name, t.color as team_color FROM submissions s JOIN teams t ON s.team_id=t.id WHERE s.status!='pending' AND s.team_id = ANY($1) ORDER BY s.reviewed_at DESC LIMIT 50", [teamIds]) : [];
    res.json({ teams: myTeams, submissions: { pending, reviewed } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Verify team PIN
app.post('/api/verify-pin', async (req, res) => {
  try {
    const { teamId, pin } = req.body;
    const team = await queryOne('SELECT * FROM teams WHERE id=$1', [teamId]);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if ((team.pin || '0000') !== String(pin)) return res.json({ valid: false });
    res.json({ valid: true, teamId: team.id, name: team.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update team PIN
app.put('/api/teams/:id/pin', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { pin } = req.body;
    if (!pin || String(pin).length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });
    await pool.query('UPDATE teams SET pin=$1 WHERE id=$2', [String(pin), id]);
    const team = await queryOne('SELECT name FROM teams WHERE id=$1', [id]);
    await addLog(null, '🔑', 'PIN updated for '+team.name);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Tasks
app.get('/api/tasks', async (req, res) => {
  try { res.json(await query('SELECT * FROM tasks ORDER BY category_id, task_num')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Add a new task
app.post('/api/tasks', async (req, res) => {
  try {
    const { category_id, category_name, category_icon, task_num, task_name, evidence, level, comment } = req.body;
    if (!category_id || !task_num || !task_name) return res.status(400).json({ error: 'Category ID, task number, and task name required' });
    const pts = LEVEL_PTS[(level || 'easy').toLowerCase()] || 20;
    const icon = category_icon || DEFAULT_ICONS[category_id] || '📋';
    await pool.query(
      'INSERT INTO tasks (category_id, category_name, category_icon, task_num, task_name, evidence, level, points, comment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [category_id, category_name || category_id, icon, parseInt(task_num), task_name, evidence || '', level || 'Easy', pts, comment || '']
    );
    await addLog(null, '➕', 'Task added: ' + task_name);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update a task
app.put('/api/tasks/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { category_name, category_icon, task_num, task_name, evidence, level, comment } = req.body;
    const existing = await queryOne('SELECT * FROM tasks WHERE id=$1', [id]);
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    const pts = LEVEL_PTS[(level || existing.level).toLowerCase()] || 20;
    await pool.query(
      'UPDATE tasks SET category_name=$1, category_icon=$2, task_num=$3, task_name=$4, evidence=$5, level=$6, points=$7, comment=$8 WHERE id=$9',
      [category_name || existing.category_name, category_icon || existing.category_icon, parseInt(task_num) || existing.task_num, task_name || existing.task_name, evidence || '', level || existing.level, pts, comment || '', id]
    );
    await addLog(null, '✏️', 'Task updated: ' + (task_name || existing.task_name));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete a task
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const task = await queryOne('SELECT * FROM tasks WHERE id=$1', [id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    await pool.query('DELETE FROM tasks WHERE id=$1', [id]);
    await addLog(null, '🗑️', 'Task deleted: ' + task.task_name);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete all tasks in a category
app.delete('/api/categories/:catId', async (req, res) => {
  try {
    const catId = req.params.catId;
    const tasks = await query('SELECT * FROM tasks WHERE category_id=$1', [catId]);
    if (tasks.length === 0) return res.status(404).json({ error: 'Category not found' });
    await pool.query('DELETE FROM tasks WHERE category_id=$1', [catId]);
    await addLog(null, '🗑️', 'Category deleted: ' + (tasks[0].category_name || catId) + ' (' + tasks.length + ' tasks)');
    res.json({ success: true, deleted: tasks.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/tasks/export', async (req, res) => {
  try {
    const tasks = await query('SELECT * FROM tasks ORDER BY category_id, task_num');
    let csv = 'Category ID,Category Name,Task ID,Task Name,Evidence,Level,Comment\n';
    for (const t of tasks) {
      csv += [t.category_id, '"'+String(t.category_name).replace(/"/g,'""')+'"', t.task_num,
        '"'+String(t.task_name).replace(/"/g,'""')+'"',
        t.evidence, t.level,
        '"'+String(t.comment||'').replace(/"/g,'""')+'"'].join(',') + '\n';
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=event-tasks.csv');
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const LEVEL_PTS = { easy: 20, medium: 30, hard: 50, rare: 70 };
const DEFAULT_ICONS = {
  community: '🤝', bonding: '💬', 'available-soon': '⏳', challenges: '⚡',
  sport: '🏃', saida: '🏛️', riddles: '🧩', getfind: '🔍', bonus: '🌟'
};

app.post('/api/tasks/import', async (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv) return res.status(400).json({ error: 'No CSV data' });
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return res.status(400).json({ error: 'CSV is empty' });
    const header = lines[0].toLowerCase();
    if (!header.includes('category') || !header.includes('task')) return res.status(400).json({ error: 'Invalid CSV format' });
    await pool.query('DELETE FROM tasks');
    const catIcons = { ...DEFAULT_ICONS };
    let imported = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = [];
      let current = '', inQuote = false;
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (ch === '"') { inQuote = !inQuote; }
        else if (ch === ',' && !inQuote) { cols.push(current.trim()); current = ''; }
        else { current += ch; }
      }
      cols.push(current.trim());
      if (cols.length < 4) continue;
      const catId = cols[0], catName = cols[1], taskNum = parseInt(cols[2]), taskName = cols[3];
      const evidence = cols[4] || '', level = cols[5] || 'Easy', comment = cols[6] || '';
      if (!catId || !taskNum || !taskName) continue;
      const pts = LEVEL_PTS[level.toLowerCase()] || 20;
      const icon = catIcons[catId] || '📋';
      await pool.query('INSERT INTO tasks (category_id,category_name,category_icon,task_num,task_name,evidence,level,points,comment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [catId, catName, icon, taskNum, taskName, evidence, level, pts, comment]);
      imported++;
    }
    await addLog(null, '📥', imported+' tasks imported from CSV');
    res.json({ success: true, imported });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Log
app.get('/api/log', async (req, res) => {
  try { res.json(await query('SELECT * FROM activity_log ORDER BY id DESC LIMIT 200')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Reset
app.post('/api/reset', async (req, res) => {
  try {
    await pool.query('DELETE FROM completions');
    await pool.query('DELETE FROM submissions');
    await pool.query('DELETE FROM activity_log');
    await pool.query('DELETE FROM members');
    await pool.query('DELETE FROM teams');
    await addLog(null, '🔄', 'Database reset');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// START
if (process.env.VERCEL) {
  initDatabase().catch(err => console.error('DB init error:', err));
  module.exports = app;
} else {
  initDatabase().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log('\n🏆 Event Dashboard: http://localhost:'+PORT);
      console.log('📝 Team Submit Page: http://localhost:'+PORT+'/submit.html');
      console.log('👤 Advisor Dashboard: http://localhost:'+PORT+'/advisor.html\n');
    });
  }).catch(err => { console.error('Failed:', err); process.exit(1); });
}
