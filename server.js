const http = require('http');
const url = require('url');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// Total students and target group sizes
const TOTAL_STUDENTS = 44;
const GROUP_SIZE_OPTIONS = [6, 7];
// We will predefine the capacity distribution: 5 groups of 6 and 2 groups of 7 => 44
const CAPACITIES = [7, 7, 6, 6, 6, 6, 6];

/** In-memory state */
let state = {
  students: [], // { name, groupId, at }
  groups: [],   // { id, capacity, members: [name] }
  devices: {},  // { [deviceId]: name }
  lastJoin: null, // { name, groupId, at }
};

function initEmptyState() {
  state.students = [];
  state.groups = CAPACITIES.map((cap, idx) => ({ id: idx + 1, capacity: cap, members: [] }));
  state.devices = {};
  state.lastJoin = null;
}

async function ensureDataDir() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
  } catch {}
}

async function loadState() {
  await ensureDataDir();
  try {
    const raw = await fsp.readFile(STATE_FILE, 'utf8');
    const obj = JSON.parse(raw);
    // Lightweight validation
    if (Array.isArray(obj.groups) && Array.isArray(obj.students)) {
      state = obj;
      if (!state.devices || typeof state.devices !== 'object') state.devices = {};
      if (!state.lastJoin || typeof state.lastJoin !== 'object') state.lastJoin = null;
      reconcileState();
      return;
    }
  } catch (e) {
    // ignore, will init
  }
  initEmptyState();
  await saveState();
}

async function saveState() {
  await ensureDataDir();
  const data = JSON.stringify(state, null, 2);
  await fsp.writeFile(STATE_FILE, data, 'utf8');
}

function reconcileState() {
  // Ensure groups members align with students
  const byGroup = new Map(state.groups.map(g => [g.id, new Set()]));
  for (const s of state.students) {
    if (!byGroup.has(s.groupId)) continue;
    byGroup.get(s.groupId).add(s.name);
  }
  for (const g of state.groups) {
    const set = byGroup.get(g.id) || new Set();
    g.members = Array.from(set);
  }
}

function normalizeName(name) {
  if (!name) return '';
  return String(name).trim().replace(/\s+/g, ' ');
}

function findStudent(name) {
  return state.students.find(s => s.name.toLowerCase() === name.toLowerCase());
}

function groupsFull() {
  const filled = state.groups.reduce((acc, g) => acc + g.members.length, 0);
  return filled >= TOTAL_STUDENTS;
}

function assignToGroup(name, targetGroupId = null) {
  const existing = findStudent(name);
  // If student specified a target group, try to join/move there and enforce capacity
  if (targetGroupId != null) {
    const target = state.groups.find(g => g.id === Number(targetGroupId));
    if (!target) return { status: 'invalid_group' };
    const remaining = target.capacity - target.members.length;
    if (existing) {
      if (existing.groupId === target.id) {
        return { status: 'exists', groupId: existing.groupId };
      }
      if (remaining <= 0) return { status: 'full', groupId: target.id };
      // Move: remove from old, add to target
      const old = state.groups.find(g => g.id === existing.groupId);
      if (old) old.members = old.members.filter(n => n.toLowerCase() !== name.toLowerCase());
      target.members.push(name);
      existing.groupId = target.id;
      existing.at = Date.now();
      state.lastJoin = { name, groupId: target.id, at: existing.at };
      return { status: 'moved', groupId: target.id };
    } else {
      if (remaining <= 0) return { status: 'full', groupId: target.id };
      target.members.push(name);
      const at = Date.now();
      state.students.push({ name, groupId: target.id, at });
      state.lastJoin = { name, groupId: target.id, at };
      return { status: 'ok', groupId: target.id };
    }
  }

  // Auto-assign fallback (teacher page or no specific choice)
  if (existing) {
    return { status: 'exists', groupId: existing.groupId };
  }
  if (groupsFull()) {
    return { status: 'full' };
  }
  const available = state.groups
    .map(g => ({ g, remaining: g.capacity - g.members.length }))
    .filter(x => x.remaining > 0)
    .sort((a, b) => (b.remaining - a.remaining) || (a.g.id - b.g.id));
  if (available.length === 0) {
    return { status: 'full' };
  }
  const chosen = available[0].g;
  chosen.members.push(name);
  const student = { name, groupId: chosen.id, at: Date.now() };
  state.students.push(student);
  state.lastJoin = { name, groupId: chosen.id, at: student.at };
  return { status: 'ok', groupId: chosen.id };
}

function removeFromGroup(name) {
  const idx = state.students.findIndex(s => s.name.toLowerCase() === String(name).toLowerCase());
  if (idx === -1) return { status: 'not_found' };
  const { groupId } = state.students[idx];
  state.students.splice(idx, 1);
  const g = state.groups.find(x => x.id === groupId);
  if (g) {
    g.members = g.members.filter(n => n.toLowerCase() !== String(name).toLowerCase());
  }
  // Do not set lastJoin on leave; it's for highlighting joins
  return { status: 'ok', groupId };
}

// Simple MIME types for static serving
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// SSE clients
const clients = new Set(); // Set<http.ServerResponse>

function broadcast() {
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch (e) {}
  }
}

function publicState() {
  // Return a minimized state for clients
  return {
    groups: state.groups.map(g => ({ id: g.id, capacity: g.capacity, members: g.members })),
    total: TOTAL_STUDENTS,
    counts: {
      joined: state.students.length,
      remaining: TOTAL_STUDENTS - state.students.length,
    },
    lastJoin: state.lastJoin,
  };
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

function badRequest(res, msg = 'Bad Request') {
  res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg);
}

async function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ''));
  try {
    // Prevent path traversal
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(PUBLIC_DIR)) return notFound(res);

    let stat = await fsp.stat(resolved).catch(() => null);
    if (!stat) {
      // Try adding index.html for directories
      if (!path.extname(resolved)) {
        const maybe = path.join(resolved, 'index.html');
        stat = await fsp.stat(maybe).catch(() => null);
        if (stat) filePath = maybe; else return notFound(res);
      } else {
        return notFound(res);
      }
    } else if (stat.isDirectory()) {
      const maybe = path.join(resolved, 'index.html');
      const stat2 = await fsp.stat(maybe).catch(() => null);
      if (stat2) filePath = maybe; else return notFound(res);
    } else {
      filePath = resolved;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { // 1MB limit
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const ct = req.headers['content-type'] || '';
      try {
        if (ct.includes('application/json')) {
          resolve(JSON.parse(raw || '{}'));
        } else if (ct.includes('application/x-www-form-urlencoded')) {
          const params = new url.URLSearchParams(raw);
          const obj = {};
          for (const [k, v] of params) obj[k] = v;
          resolve(obj);
        } else {
          resolve({ raw });
        }
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  // CORS for convenience within LAN (optional)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/') {
    return serveStatic(req, res, '/index.html');
  }

  if (req.method === 'GET' && pathname === '/join') {
    return serveStatic(req, res, '/join.html');
  }

  if (req.method === 'GET' && pathname.startsWith('/public/')) {
    // Map "/public/..." to files inside PUBLIC_DIR by stripping the prefix
    const mapped = pathname.replace(/^\/public\//, '/');
    return serveStatic(req, res, mapped);
  }

  if (req.method === 'GET' && pathname === '/state') {
    return sendJSON(res, 200, publicState());
  }

  if (req.method === 'GET' && pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    // Send initial state immediately
    res.write(`data: ${JSON.stringify(publicState())}\n\n`);
    req.on('close', () => {
      clients.delete(res);
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/join') {
    try {
      const body = await parseBody(req);
      const name = normalizeName(body.name);
      const groupId = body.groupId != null ? Number(body.groupId) : null;
      const deviceId = String(body.deviceId || '').trim();
      if (!name) return badRequest(res, '请填写有效的姓名');
      if (deviceId) {
        const bound = state.devices[deviceId];
        if (bound && bound.toLowerCase() !== name.toLowerCase()) {
          return sendJSON(res, 200, { ok: false, error: '该设备已绑定其他姓名，如需更改请联系教师' });
        }
      }
      const result = assignToGroup(name, groupId);
      if (result.status === 'ok' || result.status === 'exists') {
        if (deviceId && !state.devices[deviceId]) state.devices[deviceId] = name;
        await saveState();
        broadcast();
        return sendJSON(res, 200, { ok: true, groupId: result.groupId, status: result.status });
      }
      if (result.status === 'moved') {
        if (deviceId && !state.devices[deviceId]) state.devices[deviceId] = name;
        await saveState();
        broadcast();
        return sendJSON(res, 200, { ok: true, groupId: result.groupId, status: result.status });
      }
      if (result.status === 'invalid_group') {
        return sendJSON(res, 200, { ok: false, error: '无效的小组编号' });
      }
      if (result.status === 'full') {
        // If specific group requested, report that group is full; otherwise all groups are full
        if (groupId != null) {
          return sendJSON(res, 200, { ok: false, error: '该小组已满，请选择其他小组' });
        }
        return sendJSON(res, 200, { ok: false, error: '所有小组已满' });
      }
      return sendJSON(res, 500, { ok: false, error: '未知错误' });
    } catch (e) {
      return sendJSON(res, 400, { ok: false, error: '请求无效' });
    }
  }

  if (req.method === 'POST' && pathname === '/leave') {
    try {
      const body = await parseBody(req);
      const name = normalizeName(body.name);
      if (!name) return badRequest(res, '请填写有效的姓名');
      const result = removeFromGroup(name);
      if (result.status === 'ok') {
        await saveState();
        broadcast();
        return sendJSON(res, 200, { ok: true, groupId: result.groupId });
      }
      return sendJSON(res, 200, { ok: false, error: '未找到该姓名' });
    } catch (e) {
      return sendJSON(res, 400, { ok: false, error: '请求无效' });
    }
  }

  if (req.method === 'POST' && pathname === '/reset') {
    try {
      const body = await parseBody(req);
      const token = String(body.token || '').trim();
      // Very simple guard. You can change this token in README or env var.
      if (token !== '' && token !== 'teacher') {
        return sendJSON(res, 403, { ok: false, error: '口令错误' });
      }
      initEmptyState();
      await saveState();
      broadcast();
      return sendJSON(res, 200, { ok: true });
    } catch (e) {
      return sendJSON(res, 400, { ok: false, error: '请求无效' });
    }
  }

  // Fallback: try static
  return serveStatic(req, res, pathname);
});

loadState().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Open this URL on the teacher device to show the QR code.');
  });
});
