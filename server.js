const express = require('express');
const initSqlJs = require('sql.js');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'event.db');

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

let db;

// ═══════════════════════════════════════════════════════════════
// DATABASE
// ═══════════════════════════════════════════════════════════════
async function initDatabase() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('📂 Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('📂 Created new database');
  }

  db.run(`CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#f97316', pin TEXT NOT NULL DEFAULT '0000',
    disqualified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.run(`CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER NOT NULL,
    name TEXT NOT NULL, FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE)`);
  db.run(`CREATE TABLE IF NOT EXISTS completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER NOT NULL,
    category_id TEXT NOT NULL, task_num INTEGER NOT NULL,
    completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, category_id, task_num),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE)`);
  db.run(`CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER NOT NULL,
    category_id TEXT NOT NULL, task_num INTEGER NOT NULL,
    note TEXT DEFAULT '', evidence_file TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE)`);
  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id TEXT NOT NULL,
    category_name TEXT NOT NULL,
    category_icon TEXT NOT NULL DEFAULT '📋',
    task_num INTEGER NOT NULL,
    task_name TEXT NOT NULL,
    evidence TEXT DEFAULT '',
    level TEXT DEFAULT 'Easy',
    points INTEGER DEFAULT 20,
    comment TEXT DEFAULT '',
    UNIQUE(category_id, task_num))`);

  db.run(`CREATE TABLE IF NOT EXISTS advisors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);

  db.run(`CREATE TABLE IF NOT EXISTS advisor_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advisor_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    UNIQUE(advisor_id, team_id),
    FOREIGN KEY (advisor_id) REFERENCES advisors(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE)`);

  db.run(`CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER,
    icon TEXT NOT NULL, message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  saveDatabase();

  // Seed if empty
  const r = db.exec('SELECT COUNT(*) FROM teams');
  if (r[0].values[0][0] === 0) {
    const defaults = [
      { name:'Team Alpha',   color:'#f97316', pin:'1111', members:['Ahmad','Sara','Omar','Layla','Youssef'] },
      { name:'Team Bravo',   color:'#3b82f6', pin:'2222', members:['Hassan','Nour','Ali','Maya','Khaled','Rana'] },
      { name:'Team Charlie', color:'#22c55e', pin:'3333', members:['Tarek','Hana','Bilal','Fatima','Rami'] },
      { name:'Team Delta',   color:'#ef4444', pin:'4444', members:['Karim','Lina','Jad','Sally','Majid','Nada','Hadi'] },
      { name:'Team Echo',    color:'#8b5cf6', pin:'5555', members:['Ralph','Diana','Samir','Mariam','Ziad'] },
      { name:'Team Foxtrot', color:'#06b6d4', pin:'6666', members:['Wael','Jana','Fadi','Rita','Tamer','Nour'] },
      { name:'Team Golf',    color:'#ec4899', pin:'7777', members:['Bassel','Yara','Ibrahim','Christina','Walid'] },
      { name:'Team Hotel',   color:'#eab308', pin:'8888', members:['Rabih','Ghida','Marwan','Lara','Hussein','Rima'] },
      { name:'Team India',   color:'#14b8a6', pin:'9999', members:['Amin','Dana','Sami','Nadine','Elie','Jana','Chris','Michel'] },
      { name:'Team Juliet',  color:'#f43f5e', pin:'1010', members:['Nabil','Aya','Charbel','Hala','Karl'] }
    ];
    for (const t of defaults) {
      db.run('INSERT INTO teams (name,color,pin) VALUES (?,?,?)', [t.name, t.color, t.pin]);
      const tid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
      for (const m of t.members) db.run('INSERT INTO members (team_id,name) VALUES (?,?)', [tid, m]);
    }
    db.run("INSERT INTO activity_log (icon,message) VALUES ('🎉','Event initialized with 10 teams!')");
    saveDatabase();
    console.log('✅ Seeded 10 default teams');
  }

  // Seed tasks if empty
  const tc = db.exec('SELECT COUNT(*) FROM tasks');
  if (tc[0].values[0][0] === 0) {
    const defaultTasks = [
      ['community','Community Service','🤝',1,'Collect 5 recyclable materials from around the city','Video','Easy',20,''],
      ['community','Community Service','🤝',2,'Go feed 4 different animals','Photo','Medium',30,''],
      ['community','Community Service','🤝',3,'Find 3 plants and make a presentation about them','Video','Medium',30,''],
      ['community','Community Service','🤝',4,'Make an awareness campaign about street cleanliness','Video','Hard',50,''],
      ['bonding','Bonding & Public Communication','💬',1,'Organize a small Dabke performance with locals','Video','Easy',20,''],
      ['bonding','Bonding & Public Communication','💬',2,'Take a picture with another team','Photo','Easy',20,''],
      ['bonding','Bonding & Public Communication','💬',3,'Capture 5 people while smiling (not your team)','Photo','Medium',30,'Get their approval'],
      ['bonding','Bonding & Public Communication','💬',4,'Interview a local about favorite place in Saida','Video','Medium',30,''],
      ['bonding','Bonding & Public Communication','💬',5,'Learn vendor signature dish','Video','Hard',50,''],
      ['available-soon','Available Soon Tasks','⏳',1,'Go to Hunchies and find ch. Majed','Photo','Medium',30,'Wait for advisor'],
      ['available-soon','Available Soon Tasks','⏳',2,"Go to Pioneer's wall and type anything","Photo",'Medium',30,'Wait for advisor'],
      ['available-soon','Available Soon Tasks','⏳',3,'Go to BOB Juice and find ch. Ahmad','Photo','Medium',30,'Wait for location'],
      ['available-soon','Available Soon Tasks','⏳',4,'Hidden task','Photo','Hard',50,'Wait for advisor'],
      ['available-soon','Available Soon Tasks','⏳',5,'Catch the flag','Photo','Rare',70,'Wait for location'],
      ['challenges','Challenges','⚡',1,'Get a camel-hair with a proof','Photo','Easy',20,''],
      ['challenges','Challenges','⚡',2,'Get a signature from someone wearing a red hat','Video','Easy',20,''],
      ['challenges','Challenges','⚡',3,'Take a pic with animal at Pets N Claws','Photo','Easy',20,''],
      ['challenges','Challenges','⚡',4,'Try to fish','Photo','Easy',20,''],
      ['challenges','Challenges','⚡',5,'Collect 5 ants in a bottle','Photo','Easy',20,''],
      ['challenges','Challenges','⚡',6,'All members follow @vip.bob.taxi on Instagram','Photo','Easy',20,''],
      ['challenges','Challenges','⚡',7,'Take a picture with a BOB taxi car','Photo','Medium',30,''],
      ['challenges','Challenges','⚡',8,'Buy anything with 1000 Lira','Photo','Medium',30,''],
      ['challenges','Challenges','⚡',9,'Find Markit Driver, selfie, tag @markit','Photo','Medium',30,'Don not forget to smile'],
      ['challenges','Challenges','⚡',10,'Help anyone who needs to change a tire','Photo','Medium',30,''],
      ['challenges','Challenges','⚡',11,'Trade anything starting from a pen','Video','Medium',30,''],
      ['challenges','Challenges','⚡',12,'Make a vlog for Event','Video','Medium',30,''],
      ['challenges','Challenges','⚡',13,'Find a local business open for over 50 years','Photo','Medium',30,''],
      ['challenges','Challenges','⚡',14,'Take a picture of money from another country','Photo','Medium',30,'Not LBP / Dollar'],
      ['challenges','Challenges','⚡',15,"Like @LSA.S1 comment on @amccocamping post",'Screenshot','Medium',30,''],
      ['challenges','Challenges','⚡',16,'Find Markit App QR code, scan, download, verify','Screenshot','Hard',50,''],
      ['challenges','Challenges','⚡',17,'Go to Makari Engineering and solve the task (10-1:30)','Photo','Hard',50,''],
      ['challenges','Challenges','⚡',18,'Take a picture of a foreign car plate','Photo','Hard',50,'Ask the driver first'],
      ['challenges','Challenges','⚡',19,'Photo with famous person (1M+ followers)','Photo','Hard',50,''],
      ['challenges','Challenges','⚡',20,"Get last year's Event bracelet",'Photo','Hard',50,''],
      ['challenges','Challenges','⚡',21,'Fastest apple eating with no hands at Saida Beach','Video','Rare',70,''],
      ['challenges','Challenges','⚡',22,'Biggest car plate number with letter S','Photo','Rare',70,''],
      ['sport','Sport & Fitness','🏃',1,'Human pyramid with another team','Photo','Medium',30,''],
      ['sport','Sport & Fitness','🏃',2,'Win tug of war at Saida Beach (11-1:30)','Video','Hard',50,''],
      ['sport','Sport & Fitness','🏃',3,'Most pull-ups at Saida Stadium (10-1:30)','Video','Rare',70,''],
      ['sport','Sport & Fitness','🏃',4,'Most push-ups at Saida Stadium (10-1:30)','Video','Rare',70,''],
      ['sport','Sport & Fitness','🏃',5,'Fastest run at Saida Stadium (10-1:30)','Video','Rare',70,''],
      ['sport','Sport & Fitness','🏃',6,'Fastest climb at Saida Mall (3:30-5:00)','Video','Rare',70,''],
      ['saida','Saida City','🏛️',1,'Go to Saida Castle and take a picture','Photo','Easy',20,''],
      ['saida','Saida City','🏛️',2,'Take a picture in the Soap Museum','Photo','Easy',20,''],
      ['saida','Saida City','🏛️',3,'Find 5 street names in Saida','Photo','Medium',30,''],
      ['saida','Saida City','🏛️',4,'Go to 3 Khans in Old Saida','Photo','Medium',30,''],
      ['saida','Saida City','🏛️',5,'Visit a traditional bakery, learn about manakish','Video','Medium',30,''],
      ['saida','Saida City','🏛️',6,'Photograph five different doors in the Old Souk','Photo','Medium',30,''],
      ['saida','Saida City','🏛️',7,'Photograph an abandoned building','Photo','Medium',30,''],
      ['saida','Saida City','🏛️',8,'Find مختار in Saida and take a picture','Photo','Hard',50,''],
      ['riddles','Riddles & Treasure Hunt','🧩',1,'Download "That Level Again 2" and solve riddles','Screenshot','Medium',30,''],
      ['riddles','Riddles & Treasure Hunt','🧩',2,'Go to دوار القناية, solve the morse code','Photo','Hard',50,'Ask advisor for guide'],
      ['riddles','Riddles & Treasure Hunt','🧩',3,'Go to Khatib Center, scan QR, complete tasks','Photo','Hard',50,''],
      ['getfind','Get & Find','🔍',1,'Get any stamp (طابع)','Photo','Easy',20,''],
      ['getfind','Get & Find','🔍',2,'Get a 500 LBP and a 250 LBP coin','Photo','Easy',20,''],
      ['getfind','Get & Find','🔍',3,'Get 5 different screw sizes','Photo','Easy',20,''],
      ['getfind','Get & Find','🔍',4,'Find a street named after a famous person','Photo','Easy',20,''],
      ['getfind','Get & Find','🔍',5,'Find an electric car','Photo','Medium',30,''],
      ['getfind','Get & Find','🔍',6,'Find a local speaking non-Arabic/English/French','Video','Medium',30,''],
      ['getfind','Get & Find','🔍',7,'Find artisan in Old Souk, create handmade souvenir','Photo','Hard',50,''],
      ['bonus','Bonus','🌟',1,'First team to finish all Easy tasks','Advisor','Rare',70,''],
      ['bonus','Bonus','🌟',2,'First team to finish all Medium tasks','Advisor','Rare',70,''],
      ['bonus','Bonus','🌟',3,'First team to finish one entire category','Advisor','Rare',70,''],
      ['bonus','Bonus','🌟',4,'Design a new Event logo','Photo','Rare',70,'Will influence next year event'],
      ['bonus','Bonus','🌟',5,'Make the longest straight line of people','Photo','Rare',70,'']
    ];
    for (const t of defaultTasks) {
      db.run('INSERT INTO tasks (category_id,category_name,category_icon,task_num,task_name,evidence,level,points,comment) VALUES (?,?,?,?,?,?,?,?,?)', t);
    }
    saveDatabase();
    console.log('✅ Seeded 65 default tasks');
  }
}

function saveDatabase() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function queryAll(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function queryOne(sql, params) {
  const rows = queryAll(sql, params);
  return rows.length ? rows[0] : null;
}
function addLog(teamId, icon, message) {
  db.run('INSERT INTO activity_log (team_id,icon,message) VALUES (?,?,?)', [teamId, icon, message]);
}
function getTeamsFull() {
  const teams = queryAll('SELECT * FROM teams ORDER BY id');
  const members = queryAll('SELECT * FROM members ORDER BY id');
  const comps = queryAll('SELECT * FROM completions');
  return teams.map(t => ({
    id: t.id, name: t.name, color: t.color, pin: t.pin || '0000', disqualified: !!t.disqualified,
    members: members.filter(m => m.team_id === t.id).map(m => m.name),
    completions: comps.filter(c => c.team_id === t.id).map(c => ({ categoryId: c.category_id, taskNum: c.task_num }))
  }));
}

// ═══════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════

app.get('/api/state', (req, res) => {
  try {
    const teams = getTeamsFull();
    const log = queryAll('SELECT * FROM activity_log ORDER BY id DESC LIMIT 200');
    const pending = queryAll("SELECT s.*, t.name as team_name, t.color as team_color FROM submissions s JOIN teams t ON s.team_id=t.id WHERE s.status='pending' ORDER BY s.submitted_at DESC");
    const reviewed = queryAll("SELECT s.*, t.name as team_name, t.color as team_color FROM submissions s JOIN teams t ON s.team_id=t.id WHERE s.status!='pending' ORDER BY s.reviewed_at DESC LIMIT 100");
    res.json({ teams, log, submissions: { pending, reviewed } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Teams CRUD
app.post('/api/teams', (req, res) => {
  try {
    const { name, color, members } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    if (!members || members.length < 1) return res.status(400).json({ error: 'Need at least 1 member' });
    if (members.length > 8) return res.status(400).json({ error: 'Max 8 members' });
    db.run('INSERT INTO teams (name,color) VALUES (?,?)', [name, color || '#f97316']);
    const tid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    for (const m of members) db.run('INSERT INTO members (team_id,name) VALUES (?,?)', [tid, m]);
    addLog(tid, '🆕', 'Team "'+name+'" created');
    saveDatabase(); res.json({ success: true, teamId: tid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/teams/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, color, members } = req.body;
    const team = queryOne('SELECT * FROM teams WHERE id=?', [id]);
    if (!team) return res.status(404).json({ error: 'Not found' });
    db.run('UPDATE teams SET name=?,color=? WHERE id=?', [name||team.name, color||team.color, id]);
    if (members && Array.isArray(members)) {
      db.run('DELETE FROM members WHERE team_id=?', [id]);
      for (const m of members) db.run('INSERT INTO members (team_id,name) VALUES (?,?)', [id, m]);
    }
    addLog(id, '✏️', 'Team "'+name+'" updated');
    saveDatabase(); res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/teams/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const team = queryOne('SELECT * FROM teams WHERE id=?', [id]);
    if (!team) return res.status(404).json({ error: 'Not found' });
    db.run('DELETE FROM completions WHERE team_id=?', [id]);
    db.run('DELETE FROM submissions WHERE team_id=?', [id]);
    db.run('DELETE FROM members WHERE team_id=?', [id]);
    db.run('DELETE FROM teams WHERE id=?', [id]);
    addLog(null, '🗑️', 'Team "'+team.name+'" deleted');
    saveDatabase(); res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Members
app.post('/api/teams/:id/members', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const c = queryOne('SELECT COUNT(*) as c FROM members WHERE team_id=?', [id]);
    if (c.c >= 8) return res.status(400).json({ error: 'Max 8 members' });
    db.run('INSERT INTO members (team_id,name) VALUES (?,?)', [id, name]);
    const team = queryOne('SELECT name FROM teams WHERE id=?', [id]);
    addLog(id, '👤', name+' joined '+team.name);
    saveDatabase(); res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/teams/:teamId/members/:idx', (req, res) => {
  try {
    const tid = parseInt(req.params.teamId);
    const idx = parseInt(req.params.idx);
    const members = queryAll('SELECT * FROM members WHERE team_id=? ORDER BY id', [tid]);
    if (members.length <= 1) return res.status(400).json({ error: 'Need at least 1 member' });
    const target = members[idx];
    if (!target) return res.status(404).json({ error: 'Not found' });
    db.run('DELETE FROM members WHERE id=?', [target.id]);
    const team = queryOne('SELECT name FROM teams WHERE id=?', [tid]);
    addLog(tid, '👤', target.name+' removed from '+team.name);
    saveDatabase(); res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Disqualify
app.put('/api/teams/:id/disqualify', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const team = queryOne('SELECT * FROM teams WHERE id=?', [id]);
    if (!team) return res.status(404).json({ error: 'Not found' });
    const v = team.disqualified ? 0 : 1;
    db.run('UPDATE teams SET disqualified=? WHERE id=?', [v, id]);
    addLog(id, v?'🚫':'✅', team.name+(v?' DISQUALIFIED':' reinstated'));
    saveDatabase(); res.json({ success: true, disqualified: !!v });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Completions (admin manual toggle)
app.post('/api/completions/toggle', (req, res) => {
  try {
    const { teamId, categoryId, taskNum } = req.body;
    const existing = queryOne('SELECT * FROM completions WHERE team_id=? AND category_id=? AND task_num=?', [teamId, categoryId, taskNum]);
    const team = queryOne('SELECT name FROM teams WHERE id=?', [teamId]);
    if (!team) return res.status(404).json({ error: 'Not found' });
    if (existing) {
      db.run('DELETE FROM completions WHERE team_id=? AND category_id=? AND task_num=?', [teamId, categoryId, taskNum]);
      addLog(teamId, '↩️', team.name+' unchecked '+categoryId+'-'+taskNum);
      saveDatabase(); res.json({ completed: false });
    } else {
      db.run('INSERT INTO completions (team_id,category_id,task_num) VALUES (?,?,?)', [teamId, categoryId, taskNum]);
      addLog(teamId, '✅', team.name+' completed '+categoryId+'-'+taskNum);
      saveDatabase(); res.json({ completed: true });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// SUBMISSIONS (no multer — file sent as base64 in JSON)
// ═══════════════════════════════════════════════════════════════

app.post('/api/submissions', (req, res) => {
  try {
    const { teamId, categoryId, taskNum, note, fileName, fileData } = req.body;
    if (!teamId || !categoryId || !taskNum) return res.status(400).json({ error: 'Missing fields' });

    const team = queryOne('SELECT name FROM teams WHERE id=?', [teamId]);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    // Check already pending
    const pending = queryOne("SELECT * FROM submissions WHERE team_id=? AND category_id=? AND task_num=? AND status='pending'", [teamId, categoryId, taskNum]);
    if (pending) return res.status(400).json({ error: 'Already have a pending submission for this task' });

    // Check already approved
    const approved = queryOne('SELECT * FROM completions WHERE team_id=? AND category_id=? AND task_num=?', [teamId, categoryId, taskNum]);
    if (approved) return res.status(400).json({ error: 'This task is already approved' });

    // Save evidence file if provided
    let savedFileName = '';
    if (fileData && fileName) {
      const ext = path.extname(fileName) || '.jpg';
      savedFileName = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
      const base64 = fileData.replace(/^data:.*?;base64,/, '');
      fs.writeFileSync(path.join(UPLOADS_DIR, savedFileName), Buffer.from(base64, 'base64'));
    }

    db.run('INSERT INTO submissions (team_id,category_id,task_num,note,evidence_file) VALUES (?,?,?,?,?)',
      [teamId, categoryId, taskNum, note || '', savedFileName]);
    addLog(teamId, '📨', team.name+' submitted '+categoryId+'-'+taskNum+' for review');
    saveDatabase();
    res.json({ success: true, message: 'Submitted! Waiting for admin approval.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/submissions', (req, res) => {
  try {
    const status = req.query.status || 'pending';
    res.json(queryAll("SELECT s.*, t.name as team_name, t.color as team_color FROM submissions s JOIN teams t ON s.team_id=t.id WHERE s.status=? ORDER BY s.submitted_at DESC", [status]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/submissions/:id/approve', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const sub = queryOne('SELECT * FROM submissions WHERE id=?', [id]);
    if (!sub) return res.status(404).json({ error: 'Not found' });
    if (sub.status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });
    db.run("UPDATE submissions SET status='approved', reviewed_at=datetime('now') WHERE id=?", [id]);
    const existing = queryOne('SELECT * FROM completions WHERE team_id=? AND category_id=? AND task_num=?', [sub.team_id, sub.category_id, sub.task_num]);
    if (!existing) db.run('INSERT INTO completions (team_id,category_id,task_num) VALUES (?,?,?)', [sub.team_id, sub.category_id, sub.task_num]);
    const team = queryOne('SELECT name FROM teams WHERE id=?', [sub.team_id]);
    addLog(sub.team_id, '✅', team.name+' — '+sub.category_id+'-'+sub.task_num+' APPROVED');
    saveDatabase(); res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/submissions/:id/reject', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const sub = queryOne('SELECT * FROM submissions WHERE id=?', [id]);
    if (!sub) return res.status(404).json({ error: 'Not found' });
    if (sub.status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });
    const reason = req.body.reason || '';
    db.run("UPDATE submissions SET status='rejected', reviewed_at=datetime('now') WHERE id=?", [id]);
    const team = queryOne('SELECT name FROM teams WHERE id=?', [sub.team_id]);
    addLog(sub.team_id, '❌', team.name+' — '+sub.category_id+'-'+sub.task_num+' REJECTED'+(reason?': '+reason:''));
    saveDatabase(); res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Log
app.get('/api/log', (req, res) => {
  try { res.json(queryAll('SELECT * FROM activity_log ORDER BY id DESC LIMIT 200')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Reset
app.post('/api/reset', (req, res) => {
  try {
    db.run('DELETE FROM completions'); db.run('DELETE FROM submissions');
    db.run('DELETE FROM activity_log'); db.run('DELETE FROM members'); db.run('DELETE FROM teams');
    addLog(null, '🔄', 'Database reset');
    saveDatabase(); res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// TASKS EXPORT / IMPORT
// ═══════════════════════════════════════════════════════════════

// Get all tasks (for frontend to build CATEGORIES)
app.get('/api/tasks', (req, res) => {
  try {
    const tasks = queryAll('SELECT * FROM tasks ORDER BY category_id, task_num');
    res.json(tasks);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Export tasks as CSV (simple format)
app.get('/api/tasks/export', (req, res) => {
  try {
    const tasks = queryAll('SELECT * FROM tasks ORDER BY category_id, task_num');
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

// Points auto-calculated from level
const LEVEL_PTS = { easy: 20, medium: 30, hard: 50, rare: 70 };
const DEFAULT_ICONS = {
  community: '🤝', bonding: '💬', 'available-soon': '⏳', challenges: '⚡',
  sport: '🏃', saida: '🏛️', riddles: '🧩', getfind: '🔍', bonus: '🌟'
};

// Import tasks from CSV (replaces all tasks)
app.post('/api/tasks/import', (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv) return res.status(400).json({ error: 'No CSV data' });

    const lines = csv.trim().split('\n');
    if (lines.length < 2) return res.status(400).json({ error: 'CSV is empty' });

    const header = lines[0].toLowerCase();
    if (!header.includes('category') || !header.includes('task')) {
      return res.status(400).json({ error: 'Invalid CSV format. Use the exported template.' });
    }

    db.run('DELETE FROM tasks');

    // Track icons per category for auto-assignment
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
      const catId = cols[0];
      const catName = cols[1];
      const taskNum = parseInt(cols[2]);
      const taskName = cols[3];
      const evidence = cols[4] || '';
      const level = cols[5] || 'Easy';
      const comment = cols[6] || '';

      if (!catId || !taskNum || !taskName) continue;

      // Auto-derive points from level
      const pts = LEVEL_PTS[level.toLowerCase()] || 20;
      // Auto-assign icon
      const icon = catIcons[catId] || '📋';

      db.run('INSERT INTO tasks (category_id,category_name,category_icon,task_num,task_name,evidence,level,points,comment) VALUES (?,?,?,?,?,?,?,?,?)',
        [catId, catName, icon, taskNum, taskName, evidence, level, pts, comment]);
      imported++;
    }

    addLog(null, '📥', imported + ' tasks imported from CSV');
    saveDatabase();
    res.json({ success: true, imported });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// ADVISORS
// ═══════════════════════════════════════════════════════════════

// Get all advisors (admin)
app.get('/api/advisors', (req, res) => {
  try {
    const advisors = queryAll('SELECT * FROM advisors ORDER BY id');
    const links = queryAll('SELECT * FROM advisor_teams');
    res.json(advisors.map(a => ({
      id: a.id, username: a.username, name: a.name, active: !!a.active,
      teams: links.filter(l => l.advisor_id === a.id).map(l => l.team_id)
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create advisor (admin)
app.post('/api/advisors', (req, res) => {
  try {
    const { username, password, name, teams } = req.body;
    if (!username || !password || !name) return res.status(400).json({ error: 'All fields required' });
    if (!teams || teams.length < 1) return res.status(400).json({ error: 'Assign at least 1 team' });
    if (teams.length > 4) return res.status(400).json({ error: 'Max 4 teams per advisor' });

    const existing = queryOne('SELECT * FROM advisors WHERE username=?', [username]);
    if (existing) return res.status(400).json({ error: 'Username already exists' });

    db.run('INSERT INTO advisors (username,password,name) VALUES (?,?,?)', [username, password, name]);
    const aid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    for (const tid of teams) {
      db.run('INSERT INTO advisor_teams (advisor_id,team_id) VALUES (?,?)', [aid, tid]);
    }
    addLog(null, '👤', 'Advisor "'+name+'" created');
    saveDatabase(); res.json({ success: true, advisorId: aid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update advisor (admin)
app.put('/api/advisors/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { password, name, teams, active } = req.body;
    const advisor = queryOne('SELECT * FROM advisors WHERE id=?', [id]);
    if (!advisor) return res.status(404).json({ error: 'Not found' });

    if (password) db.run('UPDATE advisors SET password=? WHERE id=?', [password, id]);
    if (name) db.run('UPDATE advisors SET name=? WHERE id=?', [name, id]);
    if (active !== undefined) db.run('UPDATE advisors SET active=? WHERE id=?', [active ? 1 : 0, id]);

    if (teams && Array.isArray(teams)) {
      if (teams.length > 4) return res.status(400).json({ error: 'Max 4 teams' });
      db.run('DELETE FROM advisor_teams WHERE advisor_id=?', [id]);
      for (const tid of teams) db.run('INSERT INTO advisor_teams (advisor_id,team_id) VALUES (?,?)', [id, tid]);
    }

    addLog(null, '✏️', 'Advisor "'+name+'" updated');
    saveDatabase(); res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete advisor (admin)
app.delete('/api/advisors/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const advisor = queryOne('SELECT * FROM advisors WHERE id=?', [id]);
    if (!advisor) return res.status(404).json({ error: 'Not found' });
    db.run('DELETE FROM advisor_teams WHERE advisor_id=?', [id]);
    db.run('DELETE FROM advisors WHERE id=?', [id]);
    addLog(null, '🗑️', 'Advisor "'+advisor.name+'" deleted');
    saveDatabase(); res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Advisor login
app.post('/api/advisor/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const advisor = queryOne('SELECT * FROM advisors WHERE username=? AND password=? AND active=1', [username, password]);
    if (!advisor) return res.status(401).json({ error: 'Invalid credentials' });

    const teamLinks = queryAll('SELECT team_id FROM advisor_teams WHERE advisor_id=?', [advisor.id]);
    const teamIds = teamLinks.map(l => l.team_id);
    const allTeams = getTeamsFull();
    const myTeams = allTeams.filter(t => teamIds.includes(t.id));

    res.json({
      success: true,
      advisor: { id: advisor.id, name: advisor.name, username: advisor.username },
      teams: myTeams
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Advisor: get their data (teams + submissions)
app.get('/api/advisor/:id/state', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const advisor = queryOne('SELECT * FROM advisors WHERE id=?', [id]);
    if (!advisor) return res.status(404).json({ error: 'Not found' });

    const teamLinks = queryAll('SELECT team_id FROM advisor_teams WHERE advisor_id=?', [id]);
    const teamIds = teamLinks.map(l => l.team_id);
    const allTeams = getTeamsFull();
    const myTeams = allTeams.filter(t => teamIds.includes(t.id));

    const pending = queryAll(
      "SELECT s.*, t.name as team_name, t.color as team_color FROM submissions s JOIN teams t ON s.team_id=t.id WHERE s.status='pending' AND s.team_id IN ("+teamIds.join(',')+') ORDER BY s.submitted_at DESC',
    );
    const reviewed = queryAll(
      "SELECT s.*, t.name as team_name, t.color as team_color FROM submissions s JOIN teams t ON s.team_id=t.id WHERE s.status!='pending' AND s.team_id IN ("+teamIds.join(',')+') ORDER BY s.reviewed_at DESC LIMIT 50',
    );

    res.json({ teams: myTeams, submissions: { pending, reviewed } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Verify team PIN
app.post('/api/verify-pin', (req, res) => {
  try {
    const { teamId, pin } = req.body;
    const team = queryOne('SELECT * FROM teams WHERE id=?', [teamId]);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if ((team.pin || '0000') !== String(pin)) return res.json({ valid: false });
    res.json({ valid: true, teamId: team.id, name: team.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update team PIN (admin)
app.put('/api/teams/:id/pin', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { pin } = req.body;
    if (!pin || String(pin).length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });
    db.run('UPDATE teams SET pin=? WHERE id=?', [String(pin), id]);
    const team = queryOne('SELECT name FROM teams WHERE id=?', [id]);
    addLog(null, '🔑', 'PIN updated for '+team.name);
    saveDatabase(); res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ═══════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🏆 Event Dashboard: http://localhost:'+PORT);
    console.log('📝 Team Submit Page: http://localhost:'+PORT+'/submit.html\n');
  });
}).catch(err => { console.error('Failed:', err); process.exit(1); });
