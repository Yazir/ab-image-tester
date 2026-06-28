# AB Image Tester

Self-hosted A/B preference testing for images. Create polls, upload images, and let voters pick winners in randomized pairwise comparisons.

## Quick Start (dev)

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deployment

### Prerequisites

- Node.js 18+
- A reverse proxy (nginx, caddy, etc.) for HTTPS in production

### Setup

```bash
git clone <repo-url> ab-image-tester
cd ab-image-tester
npm install
npm run build
```

### Run

```bash
PORT=3000 node dist/server/index.js
```

All state is stored in `data/` (SQLite database, uploaded images, voter secret). No external services required.

### Reverse Proxy (nginx)

```
server {
    listen 443 ssl;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
}
```

### Deployment Checklist

- [ ] Node.js 18+ installed on target machine
- [ ] `npm install` completed
- [ ] `npm run build` completed successfully
- [ ] Reverse proxy configured with TLS (HTTPS)
- [ ] `X-Forwarded-*` headers set in reverse proxy (required for CSRF protection)
- [ ] `data/` directory is writable by the Node process
- [ ] Process manager set up (PM2, systemd, or supervisor)
- [ ] Firewall allows traffic on reverse proxy port (443/80), blocks direct Node port (3000)
- [ ] Test: open your domain, create a poll, upload images, vote, verify results

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP server port |

`VOTER_SECRET` is auto-generated and persisted to `data/.voter_secret`. No manual configuration needed.

### Persistence

- **Database**: `data/app.db` (SQLite, WAL mode, auto-created)
- **Uploads**: `data/uploads/` (auto-created)
- **Voter secret**: `data/.voter_secret` (auto-generated on first run)

Backup the entire `data/` directory to preserve all state.

### Process Manager (systemd example)

```
[Unit]
Description=AB Image Tester
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/ab-image-tester
ExecStart=/usr/bin/node dist/server/index.js
Restart=on-failure
Environment=NODE_ENV=production PORT=3000

[Install]
WantedBy=multi-user.target
```
