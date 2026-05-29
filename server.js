require('dotenv').config();
const express = require('express');
const { Client } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads folder exists
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E6);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Database Client Configuration
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function query(text, params) {
  return (await client.query(text, params)).rows;
}

// Initialize Database Tables Configuration
async function initDB() {
  await client.connect();
  
  await client.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      color VARCHAR(50) NOT NULL,
      pin VARCHAR(10) DEFAULT '0000',
      disqualified BOOLEAN DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY,
      team_id INT REFERENCES teams(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      category_id VARCHAR(100) NOT NULL,
      category_name VARCHAR(100) NOT NULL,
      category_icon VARCHAR(50) DEFAULT '📋',
      task_num INT NOT NULL,
      task_name TEXT NOT NULL,
      evidence VARCHAR(50) DEFAULT 'Photo',
      level VARCHAR(50) DEFAULT 'Easy',
      points INT DEFAULT 20,
      comment TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS completions (
      id SERIAL PRIMARY KEY,
      team_id INT REFERENCES teams(id) ON DELETE CASCADE,
      category_id VARCHAR(100) NOT NULL,
      task_num INT NOT NULL,
      UNIQUE(team_id, category_id, task_num)
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      icon VARCHAR(50) DEFAULT '📜',
      message TEXT NOT NULL,
      team_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS advisors (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      username VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(100) NOT NULL,
      teams INT[] DEFAULT '{}',
      active BOOLEAN DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      team_id INT REFERENCES teams(id) ON DELETE CASCADE,
      category_id VARCHAR(100) NOT NULL,
      task_num INT NOT NULL,
      evidence_file TEXT,
      note TEXT,
      status VARCHAR(50) DEFAULT 'pending',
      reason TEXT,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP
    );
  `);

  // Check if seeding is required
  const check = await query('SELECT COUNT(*) FROM activity_log');
  if (parseInt(check[0].count) === 0) {
    await seedDatabase(client);
  }
}

// Clean Database Seeding Initialization Function
async function seedDatabase(client) {
  await client.query("INSERT INTO activity_log (icon, message) VALUES ('🎉', 'Event platform initialized completely empty. Ready for configuration!')");
  console.log('✅ Base tables initialized cleanly without default sets.');
}

// Helper to construct fully joined team data objects
async function getTeamsFull() {
  const tRows = await query('SELECT * FROM teams ORDER BY id ASC');
  const mRows = await query('SELECT * FROM members ORDER BY id ASC');
  const cRows = await query('SELECT * FROM completions ORDER BY id ASC');

  return tRows.map(t => {
    return {
      ...t,
      members: mRows.filter(m => m.team_id === t.id).map(m => m.name),
      completions: cRows.filter(c => c.team_id === t.id).map(c => ({ categoryId: c.category_id, taskNum: c.task_num }))
    };
  });
}

// ── API ROUTES ──

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === (process.env.ADMIN_PASSWORD || 'saida1')) {
    return res.json({ success: true });
  }
  res.json({ success: false });
});

// Sync Layout State Data
app.get('/api/state', async (req, res) => {
  try {
    const teamsList = await getTeamsFull();
    const log = await query('SELECT * FROM activity_log ORDER BY id DESC LIMIT 200');
    const pending = await query(`
      SELECT s.*, t.name as team_name, t.color as team_color 
      FROM submissions s 
      JOIN teams t ON s.team_id = t.id 
      WHERE s.status = 'pending' 
      ORDER BY s.submitted_at DESC
    `);
    const reviewed = await query(`
      SELECT s.*, t.name as team_name, t.color as team_color 
      FROM submissions s 
      JOIN teams t ON s.team_id = t.id 
      WHERE s.status != 'pending' 
      ORDER BY s.reviewed_at DESC LIMIT 100
    `);
    res.json({ teams: teamsList, log, submissions: { pending, reviewed } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fetch Task List Blueprint array
app.get('/api/tasks', async (req, res) => {
  try { res.json(await query('SELECT * FROM tasks ORDER BY category_id ASC, task_num ASC')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Single Manual Task Entry creation node
app.post('/api/tasks', async (req, res) => {
  try {
    const { category_id, category_name, category_icon, task_num, task_name, evidence, level, comment } = req.body;
    
    // Check duplication values
    const duplicate = await query('SELECT id FROM tasks WHERE category_id = $1 AND task_num = $2', [category_id, task_num]);
    if (duplicate.length > 0) {
      return res.status(400).json({ error: `Task #${task_num} already exists inside category "${category_id}".` });
    }

    let points = 20;
    if (level === 'Medium') points = 30;
    if (level === 'Hard') points = 50;
    if (level === 'Rare') points = 70;

    const resRows = await query(`
      INSERT INTO tasks (category_id, category_name, category_icon, task_num, task_name, evidence, level, points, comment)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
    `, [category_id, category_name, category_icon, task_num, task_name, evidence, level, points, comment]);

    await query("INSERT INTO activity_log (icon, message) VALUES ('📝', $1)", [`Task #${task_num} ("${task_name}") was added manually.`]);
    res.json(resRows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Individual Task Put Configuration Modifier Node
app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { task_name, evidence, level, comment } = req.body;
    
    let points = 20;
    if (level === 'Medium') points = 30;
    if (level === 'Hard') points = 50;
    if (level === 'Rare') points = 70;

    await query(`
      UPDATE tasks 
      SET task_name = $1, evidence = $2, level = $3, points = $4, comment = $5 
      WHERE id = $6
    `, [task_name, evidence, level, points, comment, id]);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Remove individual task item blueprint
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk Delete an entire category structure
app.delete('/api/categories/:catId', async (req, res) => {
  try {
    const { catId } = req.params;
    await query('DELETE FROM tasks WHERE category_id = $1', [catId]);
    await query('DELETE FROM completions WHERE category_id = $1', [catId]);
    await query("INSERT INTO activity_log (icon, message) VALUES ('🗑️', $1)", [`Category "${catId}" and all its tasks were deleted.`]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Export Tasks Blueprint to CSV standard multi-line string configuration
app.get('/api/tasks/export', async (req, res) => {
  try {
    const dbTasks = await query('SELECT * FROM tasks ORDER BY category_id ASC, task_num ASC');
    let csv = 'Category ID,Category Name,Category Icon,Task Number,Task Name,Evidence,Level,Comment\n';
    dbTasks.forEach(t => {
      const escape = (str) => `"${(str || '').toString().replace(/"/g, '""')}"`;
      csv += `${escape(t.category_id)},${escape(t.category_name)},${escape(t.category_icon)},${t.task_num},${escape(t.task_name)},${escape(t.evidence)},${escape(t.level)},${escape(t.comment)}\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=event_tasks_export.csv');
    res.send(csv);
  } catch (err) { res.status(500).send(err.message); }
});

// Bulk Task Import Endpoint
app.post('/api/tasks/import', async (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv) return res.status(400).json({ error: 'No CSV string data parsed' });

    const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length <= 1) return res.json({ success: true, imported: 0 });

    // Wipe previous entries to perform safe cleanly structured swap
    await query('DELETE FROM tasks');

    let count = 0;
    // Simple custom regex-safe CSV parse layout runner loop
    for (let i = 1; i < lines.length; i++) {
      const matches = lines[i].match(/(".*?"|[^,\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
      if (matches.length < 5) continue;

      const clean = (str) => (str || '').replace(/^"|"$/g, '').replace(/""/g, '"').trim();
      const category_id = clean(matches[0]);
      const category_name = clean(matches[1]);
      const category_icon = clean(matches[2]) || '📋';
      const task_num = parseInt(clean(matches[3]));
      const task_name = clean(matches[4]);
      const evidence = clean(matches[5]) || 'Photo';
      const level = clean(matches[6]) || 'Easy';
      const comment = clean(matches[7]) || '';

      if (!category_id || !task_num || !task_name) continue;

      let points = 20;
      if (level === 'Medium') points = 30;
      if (level === 'Hard') points = 50;
      if (level === 'Rare') points = 70;

      await client.query(`
        INSERT INTO tasks (category_id, category_name, category_icon, task_num, task_name, evidence, level, points, comment)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [category_id, category_name, category_icon, task_num, task_name, evidence, level, points, comment]);
      count++;
    }

    await query("INSERT INTO activity_log (icon, message) VALUES ('📥', $1)", [`Bulk imported ${count} tasks completely overriding previous database setup.`]);
    res.json({ success: true, imported: count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Teams Creation Manual Endpoint Nodes
app.post('/api/teams', async (req, res) => {
  try {
    const { name, color, members } = req.body;
    const pin = Math.floor(1000 + Math.random() * 9000).toString(); // Generate unique validation token
    const tRes = await query('INSERT INTO teams (name, color, pin) VALUES ($1, $2, $3) RETURNING *', [name, color, pin]);
    const teamId = tRes[0].id;

    for (const m of members) {
      await query('INSERT INTO members (team_id, name) VALUES ($1, $2)', [teamId, m]);
    }

    await query("INSERT INTO activity_log (icon, message, team_id) VALUES ('🆕', $1, $2)", [`Team "${name}" was successfully configured into live competition.`, teamId]);
    res.json(tRes[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/teams/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, members } = req.body;
    await query('UPDATE teams SET name = $1, color = $2 WHERE id = $3', [name, color, id]);
    await query('DELETE FROM members WHERE team_id = $1', [id]);
    for (const m of members) {
      await query('INSERT INTO members (team_id, name) VALUES ($1, $2)', [id, m]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/teams/:id/pin', async (req, res) => {
  try {
    await query('UPDATE teams SET pin = $1 WHERE id = $2', [req.body.pin, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/teams/:id', async (req, res) => {
  try {
    await query('DELETE FROM teams WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/teams/:id/members', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const check = await query('SELECT COUNT(*) FROM members WHERE team_id = $1', [id]);
    if (parseInt(check[0].count) >= 8) return res.status(400).json({ error: 'Team already hit full cap (8 members)' });

    await query('INSERT INTO members (team_id, name) VALUES ($1, $2)', [id, name]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/teams/:id/members/:idx', async (req, res) => {
  try {
    const { id, idx } = req.params;
    const mRows = await query('SELECT id FROM members WHERE team_id = $1 ORDER BY id ASC', [id]);
    if (mRows[idx]) {
      await query('DELETE FROM members WHERE id = $1', [mRows[idx].id]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/teams/:id/disqualify', async (req, res) => {
  try {
    const { id } = req.params;
    const team = await query('SELECT name, disqualified FROM teams WHERE id = $1', [id]);
    const nextStatus = !team[0].disqualified;
    await query('UPDATE teams SET disqualified = $1 WHERE id = $2', [nextStatus, id]);
    
    const icon = nextStatus ? '🚫' : '✅';
    const msg = nextStatus ? `Team "${team[0].name}" has been disqualified.` : `Team "${team[0].name}" was reinstated into play.`;
    await query('INSERT INTO activity_log (icon, message, team_id) VALUES ($1, $2, $3)', [icon, msg, id]);
    
    res.json({ disqualified: nextStatus });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Live Manual Toggling Checklist Admin Function Nodes
app.post('/api/completions/toggle', async (req, res) => {
  try {
    const { teamId, categoryId, taskNum } = req.body;
    const existing = await query('SELECT id FROM completions WHERE team_id = $1 AND category_id = $2 AND task_num = $3', [teamId, categoryId, taskNum]);
    const team = await query('SELECT name FROM teams WHERE id = $1', [teamId]);

    if (existing.length > 0) {
      await query('DELETE FROM completions WHERE id = $1', [existing[0].id]);
      await query("INSERT INTO activity_log (icon, message, team_id) VALUES ('↩️', $1, $2)", [`Admin marked Task #${taskNum} inside category "${categoryId}" incomplete.`, teamId, team[0].name]);
      res.json({ status: 'removed' });
    } else {
      await query('INSERT INTO completions (team_id, category_id, task_num) VALUES ($1, $2, $3)', [teamId, categoryId, taskNum]);
      await query("INSERT INTO activity_log (icon, message, team_id) VALUES ('✅', $1, $2)", [`Admin approved completion layout parameters for Task #${taskNum} inside category "${categoryId}".`, teamId, team[0].name]);
      res.json({ status: 'added' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Advisor Database Management
app.get('/api/advisors', async (req, res) => {
  try { res.json(await query('SELECT id, name, username, teams, active FROM advisors ORDER BY id ASC')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/advisors', async (req, res) => {
  try {
    const { name, username, password, teams: selectedTeams } = req.body;
    const check = await query('SELECT id FROM advisors WHERE username = $1', [username]);
    if (check.length > 0) return res.status(400).json({ error: 'Username already allocated' });

    await query('INSERT INTO advisors (name, username, password, teams) VALUES ($1, $2, $3, $4)', [name, username, password, selectedTeams]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/advisors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, password, teams: selectedTeams } = req.body;
    if (password) {
      await query('UPDATE advisors SET name = $1, password = $2, teams = $3 WHERE id = $4', [name, password, selectedTeams, id]);
    } else {
      await query('UPDATE advisors SET name = $1, teams = $2 WHERE id = $3', [name, selectedTeams, id]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/advisors/:id/active', async (req, res) => {
  try {
    await query('UPDATE advisors SET active = $1 WHERE id = $2', [req.body.active, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/advisors/:id', async (req, res) => {
  try {
    await query('DELETE FROM advisors WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Submissions Review Nodes Pipeline 
app.put('/api/submissions/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const sub = await query('SELECT * FROM submissions WHERE id = $1', [id]);
    if (sub.length === 0) return res.status(404).json({ error: 'Submission link closed or absent.' });

    // Commit to live completions tracking data ledger safely
    await query(`
      INSERT INTO completions (team_id, category_id, task_num) 
      VALUES ($1, $2, $3) ON CONFLICT(team_id, category_id, task_num) DO NOTHING
    `, [sub[0].team_id, sub[0].category_id, sub[0].task_num]);

    await query("UPDATE submissions SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);
    
    const team = await query('SELECT name FROM teams WHERE id = $1', [sub[0].team_id]);
    await query("INSERT INTO activity_log (icon, message, team_id) VALUES ('✅', $1, $2)", [`Submission for Task #${sub[0].task_num} inside category "${sub[0].category_id}" was approved by Admin.`, sub[0].team_id]);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/submissions/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const sub = await query('SELECT * FROM submissions WHERE id = $1', [id]);
    if (sub.length === 0) return res.status(404).json({ error: 'Submission not found' });

    await query("UPDATE submissions SET status = 'rejected', reason = $1, reviewed_at = CURRENT_TIMESTAMP WHERE id = $2", [reason, id]);
    
    const team = await query('SELECT name FROM teams WHERE id = $1', [sub[0].team_id]);
    await query("INSERT INTO activity_log (icon, message, team_id) VALUES ('❌', $1, $2)", [`Submission for Task #${sub[0].task_num} inside "${sub[0].category_id}" was rejected. Reason: ${reason || 'None provided'}.`, sub[0].team_id]);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Initialization Runtime Hook
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Live Backend Engine hosting Core Dashboard API on port ${PORT}`));
}).catch(err => {
  console.error('⛔ Critical Server Failure initialization hook dropped:', err);
});
