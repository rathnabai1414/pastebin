const express = require('express');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const path = require('path');

const {
  createPaste,
  getPasteRaw,
  fetchPasteWithView,
  deletePaste,
  listAllPastes,
  getPasteStats,
  nowMs
} = require('./db');

const app = express();

// Middleware
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 5000;

// Helper to send JSON error responses
function jsonError(res, status, message) {
  return res.status(status).json({ error: message });
}

// Health check endpoint
app.get('/api/healthz', (req, res) => {
  res.json({ ok: true });
});

// Create a new paste
app.post('/api/pastes', async (req, res) => {
  const { content, ttl_seconds, max_views } = req.body || {};

  if (typeof content !== 'string' || content.trim() === '') {
    return jsonError(res, 400, 'content is required and must be a non-empty string');
  }

  if (ttl_seconds !== undefined && (!Number.isInteger(ttl_seconds) || ttl_seconds < 1)) {
    return jsonError(res, 400, 'ttl_seconds must be an integer >= 1');
  }

  if (max_views !== undefined && (!Number.isInteger(max_views) || max_views < 1)) {
    return jsonError(res, 400, 'max_views must be an integer >= 1');
  }

  try {
    const id = uuidv4();
    await createPaste({ id, content, ttl_seconds, max_views });

    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('host');
    const url = `${proto}://${host}/p/${id}`;

    res.status(201).json({ id, url });
  } catch (err) {
    console.error('Error creating paste:', err);
    jsonError(res, 500, 'Failed to create paste');
  }
});

// Fetch paste via API (counts as view)
app.get('/api/pastes/:id', async (req, res) => {
  try {
    const result = await fetchPasteWithView(req.params.id, nowMs(req));

    if (!result) {
      return res.status(404).json({ error: 'paste not found or unavailable' });
    }

    res.json({
      content: result.content,
      remaining_views: result.remaining_views,
      expires_at: result.expires_at
        ? new Date(result.expires_at).toISOString()
        : null
    });
  } catch (err) {
    console.error('Error fetching paste:', err);
    jsonError(res, 500, 'Failed to fetch paste');
  }
});

// HTML escape helper
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// View paste as HTML
app.get('/api/pastes/:id', async (req, res) => {
  try {
    const result = await fetchPasteWithView(req.params.id, nowMs(req));

    if (!result) {
      return res.status(404).send('<h1>404 Not Found</h1>');
    }

    const content = escapeHtml(result.content).replace(/\n/g, '<br>');

    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Paste ${req.params.id}</title>
  <meta charset="utf-8"/>
  <style>
    body { font-family: monospace; background:#f5f5f5; padding:20px; }
    .box { background:white; padding:20px; max-width:800px; margin:auto; border-radius:8px; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Paste ${req.params.id}</h2>
    <pre>${content}</pre>
    <a href="/">← Back</a>
  </div>
</body>
</html>
`);
  } catch (err) {
    console.error('Error viewing paste:', err);
    res.status(500).send('<h1>Server Error</h1>');
  }
});

// Paste stats
app.get('/api/pastes/:id/stats', async (req, res) => {
  try {
    const stats = await getPasteStats(req.params.id);

    if (!stats) {
      return res.status(404).json({ error: 'paste not found' });
    }

    res.json({
      id: stats.id,
      created_at: new Date(stats.created_at).toISOString(),
      expires_at: stats.expires_at
        ? new Date(stats.expires_at).toISOString()
        : null,
      remaining_views: stats.remaining_views,
      content_length: stats.content_length
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    jsonError(res, 500, 'Failed to fetch stats');
  }
});

// Delete paste
app.delete('/api/pastes/:id', async (req, res) => {
  try {
    const deleted = await deletePaste(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'paste not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting paste:', err);
    jsonError(res, 500, 'Failed to delete paste');
  }
});

// Admin list
app.get('/api/admin/pastes', async (req, res) => {
  try {
    const pastes = await listAllPastes();
    const limit = parseInt(req.query.limit) || 100;

    res.json({
      total: pastes.length,
      pastes: pastes.slice(0, limit)
    });
  } catch (err) {
    console.error('Error listing pastes:', err);
    jsonError(res, 500, 'Failed to list pastes');
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// ✅ Start server ONLY ONCE
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
