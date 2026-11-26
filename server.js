'use strict';

// OS Protegida - prototipo academico de ordens de servico e estoque.
// Requer Node.js 22+ (utiliza node:sqlite, nativo do Node).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DB_FILE = process.env.DATABASE_PATH || path.join(ROOT, 'db', 'os-protegida.sqlite');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_HOURS = 8;
const MAX_BODY = 64 * 1024;
const dbDir = path.dirname(DB_FILE);
fs.mkdirSync(dbDir, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','TECNICO','CONSULTA')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  min_quantity INTEGER NOT NULL DEFAULT 0 CHECK(min_quantity >= 0),
  unit_cost REAL NOT NULL DEFAULT 0 CHECK(unit_cost >= 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS service_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  device TEXT NOT NULL,
  problem TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ABERTA','EM_DIAGNOSTICO','AGUARDANDO_APROVACAO','EM_EXECUCAO','CONCLUIDA','CANCELADA')),
  technician_id INTEGER REFERENCES users(id),
  diagnosis TEXT,
  resolution TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS service_order_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES service_orders(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL REFERENCES parts(id),
  movement_type TEXT NOT NULL CHECK(movement_type IN ('ENTRADA','SAIDA')),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  reason TEXT NOT NULL,
  order_id INTEGER REFERENCES service_orders(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  actor_username TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  result TEXT NOT NULL,
  details_json TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
`);

const now = () => new Date().toISOString();
const safeUser = (u) => ({ id: u.id, name: u.name, username: u.username, role: u.role });
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt}:${derived.toString('hex')}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const actual = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    const expected = Buffer.from(hash, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}
function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count === 0) {
    const insert = db.prepare('INSERT INTO users(name,username,password_hash,role,active,created_at) VALUES(?,?,?,?,1,?)');
    insert.run('Administrador de demonstração', 'admin', hashPassword('Admin@Demo2026!'), 'ADMIN', now());
    insert.run('Técnico de demonstração', 'tecnico', hashPassword('Tecnico@Demo2026!'), 'TECNICO', now());
    insert.run('Consulta de demonstração', 'consulta', hashPassword('Consulta@Demo2026!'), 'CONSULTA', now());
  }
  const clientsCount = db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
  if (clientsCount === 0) {
    const ins = db.prepare('INSERT INTO clients(name,phone,email,created_at) VALUES(?,?,?,?)');
    ins.run('Marina Almeida (fictícia)', '(19) 90000-0001', 'marina.exemplo@example.test', now());
    ins.run('Rafael Costa (fictício)', '(19) 90000-0002', 'rafael.exemplo@example.test', now());
    const part = db.prepare('INSERT INTO parts(sku,name,quantity,min_quantity,unit_cost,updated_at) VALUES(?,?,?,?,?,?)');
    part.run('SSD-480', 'SSD SATA 480 GB', 6, 2, 219.90, now());
    part.run('MEM-8-DDR4', 'Memória DDR4 8 GB', 2, 2, 139.90, now());
    part.run('FAN-120', 'Cooler 120 mm', 1, 1, 35.00, now());
    const adminId = db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
    const techId = db.prepare("SELECT id FROM users WHERE username='tecnico'").get().id;
    const c1 = db.prepare("SELECT id FROM clients WHERE name LIKE 'Marina%'").get().id;
    const c2 = db.prepare("SELECT id FROM clients WHERE name LIKE 'Rafael%'").get().id;
    const insOrder = db.prepare(`INSERT INTO service_orders(code,client_id,device,problem,status,technician_id,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    insOrder.run('OS-2026-001', c1, 'Notebook - demonstração', 'Equipamento apresenta lentidão na inicialização.', 'EM_DIAGNOSTICO', techId, adminId, now(), now());
    insOrder.run('OS-2026-002', c2, 'Desktop - demonstração', 'Solicitação de limpeza e revisão preventiva.', 'EM_EXECUCAO', techId, adminId, now(), now());
    insOrder.run('OS-2026-003', c1, 'Impressora - demonstração', 'Falha intermitente na alimentação de papel.', 'ABERTA', null, adminId, now(), now());
  }
}
seed();

const loginAttempts = new Map();
function audit({ actor = null, actorUsername = null, action, entity, entityId = null, result = 'SUCCESS', details = {}, req }) {
  const ip = req?.socket?.remoteAddress || null;
  const agent = String(req?.headers?.['user-agent'] || '').slice(0, 300) || null;
  db.prepare(`INSERT INTO audit_logs(actor_id,actor_username,action,entity,entity_id,result,details_json,ip_address,user_agent,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(actor?.id ?? null, actor?.username ?? actorUsername, action, entity,
      entityId === null ? null : String(entityId), result, JSON.stringify(details).slice(0, 2000), ip, agent, now());
}
function json(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(body);
}
function fail(res, status, message, code = 'REQUEST_ERROR') { json(res, status, { error: message, code }); }
function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const key = part.slice(0, i).trim();
    try { result[key] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed cookie */ }
  }
  return result;
}
function cookie(token, maxAge) {
  const secure = NODE_ENV === 'production' ? '; Secure' : '';
  return `os_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}
function sessionFor(req) {
  const token = parseCookies(req).os_session;
  if (!token || token.length > 200) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = db.prepare(`SELECT s.id AS session_id,s.expires_at,u.id,u.name,u.username,u.role,u.active
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL`).get(tokenHash);
  if (!session || !session.active || session.expires_at <= now()) return null;
  return { sessionId: session.session_id, user: { id: session.id, name: session.name, username: session.username, role: session.role } };
}
function requireRole(req, res, roles) {
  const sess = sessionFor(req);
  if (!sess) { fail(res, 401, 'Sessão inválida ou expirada. Entre novamente.', 'UNAUTHENTICATED'); return null; }
  if (!roles.includes(sess.user.role)) {
    audit({ actor: sess.user, action: 'ACCESS_DENIED', entity: 'AUTHORIZATION', result: 'DENIED', details: { path: req.url, method: req.method }, req });
    fail(res, 403, 'Seu perfil não possui permissão para esta operação.', 'FORBIDDEN'); return null;
  }
  return sess;
}
function checkOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true; // clientes de linha de comando podem não enviar Origin
  const host = req.headers.host;
  const expectedHttp = `http://${host}`;
  const expectedHttps = `https://${host}`;
  if (origin !== expectedHttp && origin !== expectedHttps) {
    fail(res, 403, 'Origem não autorizada.', 'ORIGIN_REJECTED'); return false;
  }
  return true;
}
async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY) throw Object.assign(new Error('Corpo da requisição muito grande.'), { status: 413 });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
}
const text = (v, max, min = 1) => {
  const s = String(v ?? '').trim();
  if (s.length < min || s.length > max) throw new Error(`Campo deve conter entre ${min} e ${max} caracteres.`);
  return s;
};
const int = (v, min = 0, max = 1000000) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('Quantidade inválida.');
  return n;
};
const money = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100000000) throw new Error('Valor monetário inválido.');
  return Math.round(n * 100) / 100;
};
const passwordValid = (v) => typeof v === 'string' && Buffer.byteLength(v, 'utf8') >= 12 && Buffer.byteLength(v, 'utf8') <= 72 && /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v) && /[^A-Za-z0-9]/.test(v);
const transitions = {
  ABERTA: ['EM_DIAGNOSTICO', 'CANCELADA'],
  EM_DIAGNOSTICO: ['AGUARDANDO_APROVACAO', 'EM_EXECUCAO', 'CANCELADA'],
  AGUARDANDO_APROVACAO: ['EM_EXECUCAO', 'CANCELADA'],
  EM_EXECUCAO: ['CONCLUIDA', 'CANCELADA'],
  CONCLUIDA: [], CANCELADA: []
};

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (req.method !== 'GET' && !checkOrigin(req, res)) return;

  if (p === '/api/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    const attempt = loginAttempts.get(ip) || { count: 0, reset: Date.now() + 15 * 60 * 1000 };
    if (Date.now() > attempt.reset) { attempt.count = 0; attempt.reset = Date.now() + 15 * 60 * 1000; }
    if (attempt.count >= 5) { fail(res, 429, 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.', 'RATE_LIMIT'); return; }
    const b = await body(req);
    const username = String(b.username || '').trim().slice(0, 80);
    const password = String(b.password || '').slice(0, 100);
    const user = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username);
    const valid = user ? verifyPassword(password, user.password_hash) : verifyPassword(password, hashPassword('dummy-password-value'));
    if (!user || !valid || !user.active) {
      attempt.count += 1; loginAttempts.set(ip, attempt);
      audit({ actor: null, actorUsername: username || null, action: 'LOGIN_FAILED', entity: 'SESSION', result: 'DENIED', details: { reason: 'invalid_credentials' }, req });
      fail(res, 401, 'Usuário ou senha inválidos.', 'INVALID_CREDENTIALS'); return;
    }
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL').run(now());
    db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(tokenHash, user.id, now(), expires);
    audit({ actor: user, action: 'LOGIN_SUCCESS', entity: 'SESSION', result: 'SUCCESS', req });
    json(res, 200, { user: safeUser(user) }, { 'Set-Cookie': cookie(token, SESSION_HOURS * 3600) }); return;
  }

  if (p === '/api/logout' && req.method === 'POST') {
    const sess = requireRole(req, res, ['ADMIN','TECNICO','CONSULTA']); if (!sess) return;
    db.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').run(now(), sess.sessionId);
    audit({ actor: sess.user, action: 'LOGOUT', entity: 'SESSION', result: 'SUCCESS', req });
    json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) }); return;
  }

  if (p === '/api/me' && req.method === 'GET') {
    const sess = sessionFor(req); if (!sess) { fail(res, 401, 'Entre no sistema.', 'UNAUTHENTICATED'); return; }
    json(res, 200, { user: sess.user }); return;
  }

  if (p === '/api/dashboard' && req.method === 'GET') {
    const sess = requireRole(req, res, ['ADMIN','TECNICO','CONSULTA']); if (!sess) return;
    const counts = db.prepare(`SELECT
      SUM(CASE WHEN status NOT IN ('CONCLUIDA','CANCELADA') THEN 1 ELSE 0 END) AS open_orders,
      SUM(CASE WHEN status='EM_EXECUCAO' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status='CONCLUIDA' THEN 1 ELSE 0 END) AS completed
      FROM service_orders`).get();
    const lowStock = db.prepare('SELECT COUNT(*) AS n FROM parts WHERE quantity <= min_quantity').get().n;
    const recent = db.prepare(`SELECT so.id,so.code,so.device,so.status,so.created_at,c.name AS client_name
      FROM service_orders so JOIN clients c ON c.id=so.client_id ORDER BY so.id DESC LIMIT 5`).all();
    json(res, 200, { counts, lowStock, recent }); return;
  }

  if (p === '/api/clients' && req.method === 'GET') {
    const sess = requireRole(req, res, ['ADMIN','TECNICO','CONSULTA']); if (!sess) return;
    const rows = db.prepare('SELECT id,name,phone,email,active,created_at FROM clients ORDER BY name').all();
    json(res, 200, { clients: rows }); return;
  }
  if (p === '/api/clients' && req.method === 'POST') {
    const sess = requireRole(req, res, ['ADMIN','TECNICO']); if (!sess) return;
    const b = await body(req); const name = text(b.name, 120); const phone = String(b.phone || '').trim().slice(0, 30); const email = String(b.email || '').trim().slice(0, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fail(res, 400, 'E-mail inválido.'); return; }
    const result = db.prepare('INSERT INTO clients(name,phone,email,created_at) VALUES(?,?,?,?)').run(name, phone || null, email || null, now());
    audit({ actor: sess.user, action: 'CLIENT_CREATED', entity: 'CLIENT', entityId: result.lastInsertRowid, details: { fields: ['name','phone','email'] }, req });
    json(res, 201, { id: Number(result.lastInsertRowid) }); return;
  }

  if (p === '/api/orders' && req.method === 'GET') {
    const sess = requireRole(req, res, ['ADMIN','TECNICO','CONSULTA']); if (!sess) return;
    const rows = db.prepare(`SELECT so.id,so.code,so.device,so.problem,so.status,so.diagnosis,so.resolution,so.created_at,so.updated_at,
      c.name AS client_name,c.id AS client_id,u.name AS technician_name
      FROM service_orders so JOIN clients c ON c.id=so.client_id LEFT JOIN users u ON u.id=so.technician_id
      ORDER BY so.id DESC`).all();
    json(res, 200, { orders: rows }); return;
  }
  if (p === '/api/orders' && req.method === 'POST') {
    const sess = requireRole(req, res, ['ADMIN','TECNICO']); if (!sess) return;
    const b = await body(req); const clientId = int(b.clientId, 1); const device = text(b.device, 120); const problem = text(b.problem, 1200);
    const client = db.prepare('SELECT id FROM clients WHERE id=? AND active=1').get(clientId);
    if (!client) { fail(res, 400, 'Cliente não encontrado ou inativo.'); return; }
    const code = `OS-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const result = db.prepare(`INSERT INTO service_orders(code,client_id,device,problem,status,technician_id,created_by,created_at,updated_at)
      VALUES(?,?,?,?,'ABERTA',?,?,?,?)`).run(code, clientId, device, problem, sess.user.id, sess.user.id, now(), now());
    audit({ actor: sess.user, action: 'SERVICE_ORDER_CREATED', entity: 'SERVICE_ORDER', entityId: result.lastInsertRowid, details: { code, clientId }, req });
    json(res, 201, { id: Number(result.lastInsertRowid), code }); return;
  }
  const statusMatch = p.match(/^\/api\/orders\/(\d+)\/status$/);
  if (statusMatch && req.method === 'PATCH') {
    const sess = requireRole(req, res, ['ADMIN','TECNICO']); if (!sess) return;
    const id = int(statusMatch[1], 1); const b = await body(req); const status = String(b.status || '');
    const current = db.prepare('SELECT * FROM service_orders WHERE id=?').get(id);
    if (!current) { fail(res, 404, 'Ordem de serviço não encontrada.'); return; }
    if (!transitions[current.status]?.includes(status)) { fail(res, 409, `Transição não permitida: ${current.status} → ${status}.`, 'INVALID_TRANSITION'); return; }
    const resolution = status === 'CONCLUIDA' ? text(b.resolution, 1000, 10) : current.resolution;
    const diagnosis = b.diagnosis === undefined ? current.diagnosis : text(b.diagnosis, 1000, 0);
    db.prepare('UPDATE service_orders SET status=?,resolution=?,diagnosis=?,updated_at=? WHERE id=?').run(status, resolution, diagnosis, now(), id);
    audit({ actor: sess.user, action: 'SERVICE_ORDER_STATUS_CHANGED', entity: 'SERVICE_ORDER', entityId: id, details: { from: current.status, to: status }, req });
    json(res, 200, { ok: true }); return;
  }
  const addPartMatch = p.match(/^\/api\/orders\/(\d+)\/parts$/);
  if (addPartMatch && req.method === 'POST') {
    const sess = requireRole(req, res, ['ADMIN','TECNICO']); if (!sess) return;
    const orderId = int(addPartMatch[1], 1); const b = await body(req); const partId = int(b.partId, 1); const qty = int(b.quantity, 1, 10000);
    const order = db.prepare('SELECT id,status FROM service_orders WHERE id=?').get(orderId);
    const part = db.prepare('SELECT id,name,quantity,unit_cost FROM parts WHERE id=?').get(partId);
    if (!order || !part) { fail(res, 404, 'Ordem ou peça não encontrada.'); return; }
    if (order.status !== 'EM_EXECUCAO') { fail(res, 409, 'Peças só podem ser vinculadas durante a execução.'); return; }
    if (part.quantity < qty) { fail(res, 409, 'Estoque insuficiente. A operação foi cancelada.'); return; }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE parts SET quantity=quantity-?,updated_at=? WHERE id=? AND quantity>=?').run(qty, now(), partId, qty);
      db.prepare('INSERT INTO service_order_parts(order_id,part_id,quantity,unit_cost,created_by,created_at) VALUES(?,?,?,?,?,?)').run(orderId, partId, qty, part.unit_cost, sess.user.id, now());
      db.prepare(`INSERT INTO stock_movements(part_id,movement_type,quantity,reason,order_id,user_id,created_at)
        VALUES(?,'SAIDA',?,'Consumo em ordem de serviço',?,?,?)`).run(partId, qty, orderId, sess.user.id, now());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit({ actor: sess.user, action: 'STOCK_OUT_FOR_ORDER', entity: 'STOCK_MOVEMENT', entityId: partId, details: { orderId, quantity: qty }, req });
    json(res, 201, { ok: true }); return;
  }

  if (p === '/api/parts' && req.method === 'GET') {
    const sess = requireRole(req, res, ['ADMIN','TECNICO','CONSULTA']); if (!sess) return;
    json(res, 200, { parts: db.prepare('SELECT id,sku,name,quantity,min_quantity,unit_cost,updated_at FROM parts ORDER BY name').all() }); return;
  }
  if (p === '/api/parts' && req.method === 'POST') {
    const sess = requireRole(req, res, ['ADMIN']); if (!sess) return;
    const b = await body(req); const sku = text(b.sku, 40); const name = text(b.name, 120); const quantity = int(b.quantity, 0, 100000); const min = int(b.minQuantity ?? 0, 0, 100000); const cost = money(b.unitCost ?? 0);
    const result = db.prepare('INSERT INTO parts(sku,name,quantity,min_quantity,unit_cost,updated_at) VALUES(?,?,?,?,?,?)').run(sku, name, quantity, min, cost, now());
    if (quantity > 0) db.prepare(`INSERT INTO stock_movements(part_id,movement_type,quantity,reason,user_id,created_at) VALUES(?,'ENTRADA',?,'Saldo inicial',?,?)`).run(result.lastInsertRowid, quantity, sess.user.id, now());
    audit({ actor: sess.user, action: 'PART_CREATED', entity: 'PART', entityId: result.lastInsertRowid, details: { sku, initialQuantity: quantity }, req });
    json(res, 201, { id: Number(result.lastInsertRowid) }); return;
  }
  if (p === '/api/stock/entry' && req.method === 'POST') {
    const sess = requireRole(req, res, ['ADMIN']); if (!sess) return;
    const b = await body(req); const partId = int(b.partId, 1); const qty = int(b.quantity, 1, 100000); const reason = text(b.reason || 'Reposição de estoque', 160);
    const part = db.prepare('SELECT id FROM parts WHERE id=?').get(partId); if (!part) { fail(res, 404, 'Peça não encontrada.'); return; }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE parts SET quantity=quantity+?,updated_at=? WHERE id=?').run(qty, now(), partId);
      db.prepare(`INSERT INTO stock_movements(part_id,movement_type,quantity,reason,user_id,created_at) VALUES(?,'ENTRADA',?,?,?,?)`).run(partId, qty, reason, sess.user.id, now());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit({ actor: sess.user, action: 'STOCK_ENTRY', entity: 'STOCK_MOVEMENT', entityId: partId, details: { quantity: qty, reason }, req });
    json(res, 201, { ok: true }); return;
  }

  if (p === '/api/users' && req.method === 'GET') {
    const sess = requireRole(req, res, ['ADMIN']); if (!sess) return;
    json(res, 200, { users: db.prepare('SELECT id,name,username,role,active,created_at FROM users ORDER BY name').all() }); return;
  }
  if (p === '/api/users' && req.method === 'POST') {
    const sess = requireRole(req, res, ['ADMIN']); if (!sess) return;
    const b = await body(req); const name = text(b.name, 120); const username = text(b.username, 40); const password = String(b.password || ''); const role = String(b.role || '');
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) { fail(res, 400, 'Usuário deve ter 3 a 40 caracteres: letras, números, ponto, hífen ou sublinhado.'); return; }
    if (!passwordValid(password)) { fail(res, 400, 'Senha deve ter 12 a 72 bytes, com maiúscula, minúscula, número e símbolo.'); return; }
    if (!['TECNICO','CONSULTA'].includes(role)) { fail(res, 400, 'Perfil inválido.'); return; }
    const result = db.prepare('INSERT INTO users(name,username,password_hash,role,active,created_at) VALUES(?,?,?,?,1,?)').run(name, username, hashPassword(password), role, now());
    audit({ actor: sess.user, action: 'USER_CREATED', entity: 'USER', entityId: result.lastInsertRowid, details: { username, role }, req });
    json(res, 201, { id: Number(result.lastInsertRowid) }); return;
  }
  if (p === '/api/audit' && req.method === 'GET') {
    const sess = requireRole(req, res, ['ADMIN']); if (!sess) return;
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
    const rows = db.prepare(`SELECT id,actor_username,action,entity,entity_id,result,details_json,ip_address,created_at
      FROM audit_logs ORDER BY id DESC LIMIT ?`).all(limit);
    json(res, 200, { logs: rows }); return;
  }
  fail(res, 404, 'Rota não encontrada.', 'NOT_FOUND');
}

const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
function serveStatic(req, res, url) {
  let requestPath = decodeURIComponent(url.pathname);
  if (requestPath === '/') requestPath = '/index.html';
  const filePath = path.resolve(PUBLIC, `.${requestPath}`);
  if (!filePath.startsWith(PUBLIC + path.sep) && filePath !== path.join(PUBLIC,'index.html')) { fail(res, 403, 'Acesso negado.'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { fail(res, 404, 'Arquivo não encontrado.'); return; }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    });
    res.end(data);
  });
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (['GET','HEAD'].includes(req.method)) serveStatic(req, res, url);
    else fail(res, 405, 'Método não permitido.');
  } catch (err) {
    const status = err.status || 400;
    const message = status >= 500 ? 'Erro interno. Consulte o log do servidor.' : err.message;
    console.error(new Date().toISOString(), err.stack || err.message);
    if (!res.headersSent) fail(res, status, message, 'SERVER_ERROR'); else res.destroy();
  }
});
server.listen(PORT, HOST, () => console.log(`OS Protegida disponível em http://${HOST}:${PORT}`));
process.on('SIGINT', () => { try { db.close(); } finally { process.exit(0); } });
process.on('SIGTERM', () => { try { db.close(); } finally { process.exit(0); } });
