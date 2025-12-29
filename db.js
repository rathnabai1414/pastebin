const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'db.sqlite');
const db = new sqlite3.Database(dbPath);

// Initialize schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS pastes (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      expires_at INTEGER,
      remaining_views INTEGER,
      created_at INTEGER NOT NULL
    const path = require('path');

    // Helper to read deterministic test time
    function nowMs(req) {
      if (process.env.TEST_MODE === '1') {
        const header = req && req.get ? req.get('x-test-now-ms') : undefined;
        if (header) {
          const n = parseInt(header, 10);
          if (!Number.isNaN(n)) return n;
        }
      }
      return Date.now();
    }

    // If DATABASE_URL is provided, use Postgres; otherwise use SQLite
    if (process.env.DATABASE_URL) {
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });

      // Initialize table if needed
      (async () => {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS pastes (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            expires_at BIGINT,
            remaining_views INTEGER,
            created_at BIGINT NOT NULL
          )
        `);
      })().catch(err => console.error('DB init error', err));

      async function createPaste({ id, content, ttl_seconds, max_views }) {
        const created_at = Date.now();
        const expires_at = ttl_seconds ? created_at + ttl_seconds * 1000 : null;
        const remaining_views = typeof max_views === 'number' ? max_views : null;
        await pool.query(`INSERT INTO pastes (id, content, expires_at, remaining_views, created_at) VALUES ($1,$2,$3,$4,$5)`, [id, content, expires_at, remaining_views, created_at]);
      }

      async function getPasteRaw(id) {
        const res = await pool.query(`SELECT * FROM pastes WHERE id = $1`, [id]);
        return res.rows[0] || null;
      }

      async function fetchPasteWithView(id, now) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const res = await client.query(`SELECT * FROM pastes WHERE id = $1 FOR UPDATE`, [id]);
          const row = res.rows[0];
          if (!row) { await client.query('ROLLBACK'); return null; }

          if (row.expires_at && now >= parseInt(row.expires_at, 10)) { await client.query('ROLLBACK'); return null; }

          if (row.remaining_views !== null) {
            if (row.remaining_views <= 0) { await client.query('ROLLBACK'); return null; }
            const newVal = row.remaining_views - 1;
            await client.query(`UPDATE pastes SET remaining_views = $1 WHERE id = $2`, [newVal, id]);
            row.remaining_views = newVal;
          }

          await client.query('COMMIT');
          return row;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      }

      async function deletePaste(id) {
        const res = await pool.query(`DELETE FROM pastes WHERE id = $1`, [id]);
        return res.rowCount > 0;
      }

      async function listAllPastes() {
        const res = await pool.query(`SELECT id, created_at, expires_at, remaining_views, LENGTH(content) as content_length FROM pastes ORDER BY created_at DESC`);
        return res.rows || [];
      }

      async function getPasteStats(id) {
        const res = await pool.query(`SELECT id, created_at, expires_at, remaining_views, LENGTH(content) as content_length FROM pastes WHERE id = $1`, [id]);
        return res.rows[0] || null;
      }

      module.exports = {
        createPaste,
        getPasteRaw,
        fetchPasteWithView,
        deletePaste,
        listAllPastes,
        getPasteStats,
        nowMs
      };

    } else {
      const sqlite3 = require('sqlite3').verbose();
      const dbPath = path.join(__dirname, 'db.sqlite');
      const db = new sqlite3.Database(dbPath);

      // Initialize schema
      db.serialize(() => {
        db.run(`
          CREATE TABLE IF NOT EXISTS pastes (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            expires_at INTEGER,
            remaining_views INTEGER,
            created_at INTEGER NOT NULL
          )
        `);
      });

      function createPaste({ id, content, ttl_seconds, max_views }) {
        const created_at = Date.now();
        const expires_at = ttl_seconds ? created_at + ttl_seconds * 1000 : null;
        const remaining_views = typeof max_views === 'number' ? max_views : null;

        return new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO pastes (id, content, expires_at, remaining_views, created_at) VALUES (?, ?, ?, ?, ?)`,
            [id, content, expires_at, remaining_views, created_at],
            function(err) {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }

      function getPasteRaw(id) {
        return new Promise((resolve, reject) => {
          db.get(`SELECT * FROM pastes WHERE id = ?`, [id], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
          });
        });
      }

      function fetchPasteWithView(id, now) {
        return new Promise((resolve, reject) => {
          db.serialize(() => {
            db.run('BEGIN TRANSACTION', (err) => {
              if (err) return reject(err);

              db.get(`SELECT * FROM pastes WHERE id = ?`, [id], (err, row) => {
                if (err) { db.run('ROLLBACK'); return reject(err); }
                if (!row) { db.run('ROLLBACK', () => resolve(null)); return; }

                if (row.expires_at && now >= row.expires_at) { db.run('ROLLBACK', () => resolve(null)); return; }

                if (row.remaining_views !== null) {
                  if (row.remaining_views <= 0) { db.run('ROLLBACK', () => resolve(null)); return; }
                  const newVal = row.remaining_views - 1;
                  db.run(`UPDATE pastes SET remaining_views = ? WHERE id = ?`, [newVal, id], (err) => {
                    if (err) { db.run('ROLLBACK'); return reject(err); }
                    row.remaining_views = newVal;
                    db.run('COMMIT', () => resolve(row));
                  });
                } else {
                  db.run('COMMIT', () => resolve(row));
                }
              });
            });
          });
        });
      }

      function deletePaste(id) {
        return new Promise((resolve, reject) => {
          db.run(`DELETE FROM pastes WHERE id = ?`, [id], function(err) {
            if (err) reject(err);
            else resolve(this.changes > 0);
          });
        });
      }

      function listAllPastes() {
        return new Promise((resolve, reject) => {
          db.all(`SELECT id, created_at, expires_at, remaining_views, LENGTH(content) as content_length FROM pastes ORDER BY created_at DESC`, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          });
        });
      }

      function getPasteStats(id) {
        return new Promise((resolve, reject) => {
          db.get(`SELECT id, created_at, expires_at, remaining_views, LENGTH(content) as content_length FROM pastes WHERE id = ?`, [id], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
          });
        });
      }

      module.exports = {
        createPaste,
        getPasteRaw,
        fetchPasteWithView,
        deletePaste,
        listAllPastes,
        getPasteStats,
        nowMs
      };
    }
  });
}

// Get paste stats without counting views
function getPasteStats(id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, created_at, expires_at, remaining_views, LENGTH(content) as content_length FROM pastes WHERE id = ?`,
      [id],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      }
    );
  });
}

module.exports = {
  db,
  createPaste,
  getPasteRaw,
  fetchPasteWithView,
  deletePaste,
  listAllPastes,
  getPasteStats,
  nowMs
};
