const express = require('express');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const path = require('path');

const { createPaste, getPasteRaw, fetchPasteWithView, nowMs } = require('./db');

const app = express();
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Helper to send JSON error responses
function jsonError(res, status, message) {
  res.status(status).json({ error: message });
}

// Health check endpoint
app.get('/api/healthz', (req, res) => {
  try {
    res.set('Content-Type', 'application/json');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// Create a new paste
app.post('/api/pastes', async (req, res) => {
  const body = req.body || {};
  const content = body.content;
  const ttl_seconds = body.ttl_seconds;
  const max_views = body.max_views;

  // Validate content
  if (typeof content !== 'string' || content.trim() === '') {
    return jsonError(res, 400, 'content is required and must be a non-empty string');
  }

  // Validate ttl_seconds
  if (ttl_seconds !== undefined) {
    if (!Number.isInteger(ttl_seconds) || ttl_seconds < 1) {
      return jsonError(res, 400, 'ttl_seconds must be an integer >= 1');
    }
  }

  // Validate max_views
  if (max_views !== undefined) {
    if (!Number.isInteger(max_views) || max_views < 1) {
      return jsonError(res, 400, 'max_views must be an integer >= 1');
    }
  }

  try {
    const id = uuidv4();
    await createPaste({ id, content, ttl_seconds, max_views });

    // Build public URL using request headers
    const proto = (req.get('x-forwarded-proto') || req.protocol) || 'https';
    const host = req.get('host');
    const url = `${proto}://${host}/p/${id}`;

    res.status(201).json({ id, url });
  } catch (err) {
    console.error('Error creating paste:', err);
    jsonError(res, 500, 'Failed to create paste');
  }
});

// Fetch a paste via API (counts as a view)
app.get('/api/pastes/:id', async (req, res) => {
  const id = req.params.id;
  const now = nowMs(req);

  try {
    const result = await fetchPasteWithView(id, now);
    if (!result) {
      return res.status(404).json({ error: 'paste not found or unavailable' });
    }

    res.set('Content-Type', 'application/json');
    res.json({
      content: result.content,
      remaining_views: result.remaining_views === null ? null : result.remaining_views,
      expires_at: result.expires_at ? new Date(result.expires_at).toISOString() : null
    });
  } catch (err) {
    console.error('Error fetching paste:', err);
    jsonError(res, 500, 'Failed to fetch paste');
  }
});

// HTML escape for safe rendering
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// View a paste as HTML (counts as a view)
app.get('/p/:id', async (req, res) => {
  const id = req.params.id;
  const now = nowMs(req);

  try {
    const result = await fetchPasteWithView(id, now);
    if (!result) {
      res.status(404).set('Content-Type', 'text/html; charset=utf-8');
      res.send('<h1>404 Not Found</h1><p>Paste not found or unavailable</p>');
      return;
    }

    const content = escapeHtml(result.content).replace(/\n/g, '<br>');

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Paste ${id}</title>
  <style>
    body { font-family: monospace; padding: 20px; background-color: #f5f5f5; }
    .container { max-width: 800px; margin: 0 auto; background-color: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    pre { background-color: #f9f9f9; padding: 10px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; }
    .meta { color: #888; font-size: 0.9em; margin-bottom: 10px; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Paste ${id}</h1>
    <div class="meta">
      <p><a href="/">← Back to create paste</a></p>
    </div>
    <pre>${content}</pre>
  </div>
</body>
</html>`);
  } catch (err) {
    console.error('Error viewing paste:', err);
    res.status(500).set('Content-Type', 'text/html; charset=utf-8');
    res.send('<h1>500 Server Error</h1><p>Failed to load paste</p>');
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

module.exports = app;
