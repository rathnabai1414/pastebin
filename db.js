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
    )
  `);
});

// Get current time - respects TEST_MODE and x-test-now-ms header
function nowMs(req) {
  if (process.env.TEST_MODE === '1') {
    const header = req.get('x-test-now-ms');
    if (header) {
      const n = parseInt(header, 10);
      if (!Number.isNaN(n)) return n;
    }
  }
  return Date.now();
}

// Create a new paste
function createPaste({ id, content, ttl_seconds, max_views }) {
  const created_at = Date.now();
  const expires_at = ttl_seconds ? created_at + ttl_seconds * 1000 : null;
  const remaining_views = typeof max_views === 'number' ? max_views : null;

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO pastes (id, content, expires_at, remaining_views, created_at) 
       VALUES (?, ?, ?, ?, ?)`,
      [id, content, expires_at, remaining_views, created_at],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// Get raw paste data without checking constraints or counting views
function getPasteRaw(id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM pastes WHERE id = ?`,
      [id],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      }
    );
  });
}

// Fetch paste atomically: check constraints, decrement view count in one transaction
function fetchPasteWithView(id, now) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) return reject(err);

        db.get(
          `SELECT * FROM pastes WHERE id = ?`,
          [id],
          (err, row) => {
            if (err) {
              db.run('ROLLBACK');
              return reject(err);
            }

            if (!row) {
              db.run('ROLLBACK', () => resolve(null));
              return;
            }

            // Check TTL expiry
            if (row.expires_at && now >= row.expires_at) {
              db.run('ROLLBACK', () => resolve(null));
              return;
            }

            // Check and decrement view count
            if (row.remaining_views !== null) {
              if (row.remaining_views <= 0) {
                db.run('ROLLBACK', () => resolve(null));
                return;
              }
              const newVal = row.remaining_views - 1;
              db.run(
                `UPDATE pastes SET remaining_views = ? WHERE id = ?`,
                [newVal, id],
                (err) => {
                  if (err) {
                    db.run('ROLLBACK');
                    return reject(err);
                  }
                  row.remaining_views = newVal;
                  db.run('COMMIT', () => resolve(row));
                }
              );
            } else {
              db.run('COMMIT', () => resolve(row));
            }
          }
        );
      });
    });
  });
}

module.exports = {
  db,
  createPaste,
  getPasteRaw,
  fetchPasteWithView,
  nowMs
};
