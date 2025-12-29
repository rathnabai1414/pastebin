# Pastebin Mini

A lightweight Pastebin-like application built with Node.js and Express. Users can create text pastes, get shareable URLs, and view them with optional TTL (time-to-live) and view-count constraints.

## Features

- **Create Pastes**: Submit arbitrary text and receive a shareable URL
- **Time-based Expiry**: Optional TTL in seconds
- **View Limits**: Optional max view count per paste
- **Safe Rendering**: HTML-escaped content to prevent script execution
- **Deterministic Testing**: Support for `TEST_MODE` and `x-test-now-ms` header for automated testing
- **Clean API**: RESTful endpoints for programmatic access

## Running Locally

### Prerequisites
- Node.js 14+ and npm

### Setup

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd pastebin-mini
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```
   The server will listen on `http://localhost:3000`

4. **Development mode** (with auto-reload)
   ```bash
   npm run dev
   ```

## API Endpoints

### Health Check
```
GET /api/healthz
```
Returns `{ "ok": true }` with HTTP 200.

### Create Paste
```
POST /api/pastes
Content-Type: application/json

{
  "content": "string",
  "ttl_seconds": 60,        // optional
  "max_views": 5            // optional
}
```
**Response (201):**
```json
{
  "id": "uuid",
  "url": "https://your-domain.com/p/uuid"
}
```

### Fetch Paste (API)
```
GET /api/pastes/:id
```
**Response (200):**
```json
{
  "content": "string",
  "remaining_views": 4,       // null if unlimited
  "expires_at": "2026-01-01T00:00:00.000Z"  // null if no TTL
}
```
Each fetch counts as a view.

### View Paste (HTML)
```
GET /p/:id
```
Returns formatted HTML containing the paste.

## Persistence Layer

**SQLite** via `better-sqlite3`

- **File-based storage**: `db.sqlite` in the project root
- **Single table**: `pastes` with columns for id, content, expires_at, remaining_views, created_at
- **Atomic operations**: View count decrements are wrapped in transactions to prevent race conditions under load
- **No external dependencies**: Works out-of-the-box on any system with Node.js

For serverless/cloud deployments (e.g., Vercel), replace SQLite with a networked persistence layer (PostgreSQL, Redis, Upstash, etc.) and configure the connection via environment variables.

## Design Decisions

1. **UUID for paste IDs**: Simple, collision-free identifiers
2. **Transaction-based view counting**: Ensures no negative view counts and correctness under concurrent load
3. **Timestamp-based expiry**: Uses millisecond precision for compatibility with the `x-test-now-ms` header
4. **HTML escaping**: Content is escaped at render time to prevent XSS
5. **Request-based time**: Respects `x-test-now-ms` in `TEST_MODE=1` for deterministic testing
6. **No global mutable state**: Each request computes expiry independently; no caching of timestamps

## Testing

The application supports deterministic time for automated testing:

```bash
TEST_MODE=1 npm start
```

When `TEST_MODE=1`, the application reads the `x-test-now-ms` request header (milliseconds since epoch) and uses it as the current time for all expiry calculations. This allows tests to verify TTL and view limits without real delays.

Example test request:
```bash
curl -X GET http://localhost:3000/api/pastes/some-id \
  -H "x-test-now-ms: 1704067200000"
```

## Deployment

### Vercel

1. **Create a Vercel project** from your git repository
2. **Add environment variable** (if using networked DB):
   ```
   DATABASE_URL=your-database-url
   ```
3. **Deploy**: Push to main branch; Vercel auto-deploys
4. Your app will be live at `https://your-project.vercel.app`

### Local Deployment Checklist

- [ ] No hardcoded localhost URLs in code
- [ ] No secrets committed to repository (.gitignore covers db.sqlite)
- [ ] Database initializes automatically (no manual migrations)
- [ ] Server starts with `npm start` without additional setup

## License

MIT
