const Database = require('better-sqlite3');
const path = require('path');

// Create / open database file
const db = new Database(path.join(__dirname, 'pastebin.db'));

// Create table if not exists
db.prepare(`
  CREATE TABLE IF NOT EXISTS pastes (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    remaining_views INTEGER
  )
`).run();

// Helpers
function nowMs() {
  return Date.now();
}

// Create paste
async function createPaste({ id, content, ttl_seconds, max_views }) {
  const expires_at = ttl_seconds
    ? Date.now() + ttl_seconds * 1000
    : null;

  const stmt = db.prepare(`
    INSERT INTO pastes (id, content, created_at, expires_at, remaining_views)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    content,
    nowMs(),
    expires_at,
    max_views ?? null
  );
}

// Fetch paste + count view
async function fetchPasteWithView(id, now) {
  const paste = db.prepare(`
    SELECT * FROM pastes WHERE id = ?
  `).get(id);

  if (!paste) return null;

  // Expired
  if (paste.expires_at && paste.expires_at < now) {
    db.prepare(`DELETE FROM pastes WHERE id = ?`).run(id);
    return null;
  }

  // View limit
  if (paste.remaining_views !== null) {
    if (paste.remaining_views <= 0) return null;

    db.prepare(`
      UPDATE pastes
      SET remaining_views = remaining_views - 1
      WHERE id = ?
    `).run(id);
  }

  return {
    content: paste.content,
    remaining_views:
      paste.remaining_views === null
        ? null
        : paste.remaining_views - 1,
    expires_at: paste.expires_at
  };
}

// Stats
async function getPasteStats(id) {
  const paste = db.prepare(`
    SELECT id, created_at, expires_at, remaining_views, LENGTH(content) AS content_length
    FROM pastes WHERE id = ?
  `).get(id);

  return paste || null;
}

// Delete paste
async function deletePaste(id) {
  const result = db.prepare(`
    DELETE FROM pastes WHERE id = ?
  `).run(id);

  return result.changes > 0;
}

// List all pastes
async function listAllPastes() {
  return db.prepare(`
    SELECT id, created_at, expires_at, remaining_views, LENGTH(content) AS content_length
    FROM pastes
    ORDER BY created_at DESC
  `).all();
}

module.exports = {
  createPaste,
  fetchPasteWithView,
  getPasteStats,
  deletePaste,
  listAllPastes,
  nowMs
};
