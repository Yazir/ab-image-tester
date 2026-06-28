# AB Image Tester

Self-hosted A/B preference testing for images. Create polls, upload images, and let voters pick winners in randomized pairwise comparisons.

## Installation

### npm (dev)

```bash
npm install
npm run dev
```

Open http://localhost:3000

### npm (production)

```bash
npm install
npm run build
PORT=3000 node dist/server/index.js
```

### Docker

```bash
docker build -t ab-image-tester .
docker run -d -p 3000:3000 -v "$(pwd)/data:/app/data" ab-image-tester
```

Prebuilt image: `ghcr.io/your-username/ab-image-tester:latest` (auto-published via GitHub Actions on push to `main`).

### Docker Compose

Use the provided `docker-compose.yml`:

```bash
docker compose up -d
# with auto-updates via Watchtower:
docker compose --profile auto-update up -d
```

### Docker Compose + Anubis (PoW CAPTCHA)

[Anubis](https://github.com/techaro/anubis) is a proof-of-work challenge placed in front of the app. It protects voting from automated abuse without blocking search engine crawlers or static assets.

Use the provided `docker-compose.anubis.yml` and `anubis-bot-policy.yaml`:

```bash
docker compose -f docker-compose.anubis.yml up -d
```

The bot policy allows search engine crawlers and static assets through unchallenged. All other requests (page routes, API calls, uploads) receive the PoW challenge.

## Usage

### Admin flow

1. Open the homepage and click **Create New Poll**. A poll ID and admin token are generated and stored in your browser's session storage.
2. You are taken to the admin panel at `/admin/:pollId` with these tabs:

   **Images** — Upload up to 50 images via drag-and-drop or file browser. Each upload goes through magic-byte validation. Images can be removed individually.

   **Settings** — Set the poll title, description, and number of rounds (pairwise comparisons per voter, default 10, max 1000).

   **Container Size** — Set the display container dimensions (default 800×600) and image fit mode (`fit within` / `fill`). Includes size presets and auto-detect from uploaded image dimensions.

   **Share** — Copy the voter link (`/vote/:pollId`). Optionally generate a read-only share URL for others to view results without the admin token.

   **Metadata** — View aggregated results (win/loss percentages per image) and voter details (anonymized names, vote selections per round).

3. Click **Preview** at any time to test the voting experience without saving votes.

### Voter flow

1. Open the voter link: `https://your-domain.com/vote/:pollId`
2. A browser fingerprint is generated automatically and stored in localStorage.
3. Click **Start Voting** — the server returns a deterministically shuffled set of pairwise comparisons (seeded by poll ID + fingerprint).
4. Click the left or right image to pick a winner each round. Keyboard shortcuts: `←` / `→`.
5. After all rounds, votes are submitted and validated server-side (pairings must match the deterministic seed). One vote per fingerprint per poll.
6. Results are publicly viewable at the bottom of the vote page after voting.

### URL structure

| Route | Access | Purpose |
|---|---|---|
| `/` | Public | Homepage — create poll |
| `/admin/:pollId` | Admin token | Admin panel (images, settings, share, results) |
| `/vote/:pollId` | Public | Voter experience |
| `/vote/:pollId?share=TOKEN` | Share token | Read-only results view |
| `/api/polls/...` | Various | REST API |

## Persistence

All state is stored in `data/`:

- `data/app.db` — SQLite (WAL mode), auto-created
- `data/uploads/` — Uploaded images
- `data/.voter_secret` — Auto-generated secret for HMAC voter token signing

Backup the entire `data/` directory. No external services required.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | — | Set to `production` for reduced error logging |
| `TRUST_PROXY` | — | Set to `1` behind a reverse proxy (nginx, Anubis, etc.) |
