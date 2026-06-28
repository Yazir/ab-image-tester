# AB Image Tester — Implementation Plan

## Architecture

```
backend (Express + TypeScript)          frontend (Vanilla TS, SPA)
  src/server/                             src/client/
    index.ts          entry point           index.html       shell
    store.ts          file-based JSON DB    styles/main.css  all styles
    types.ts          shared types          ts/
    routes/                                   main.ts        router
      poll.ts         CRUD polls              api.ts         fetch helpers
      vote.ts         voting + algorithm      pages/
      upload.ts       multer uploads            home.ts      landing
      admin.ts        metadata                 admin.ts     poll editor
    middleware/                                 vote.ts      voter UI
      rateLimit.ts   rate limiting              metadata.ts voter data viewer
      security.ts    admin token auth         components/
                                                dragDrop.ts
```

## Data Models (stored in `data/`)

- **poll** — id, adminToken, shareToken, title, description, images[], rounds, containerWidth/Height, createdAt
- **vote** — id, pollId, voterFingerprint, selections[{round, leftId, rightId, winnerId}], votedAt

## Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/polls | none | Create poll → returns adminToken |
| GET | /api/polls/:pollId | admin | Get poll details |
| PATCH | /api/polls/:pollId | admin | Update poll settings |
| POST | /api/polls/:pollId/upload | admin | Upload image |
| DELETE | /api/polls/:pollId/images/:imgId | admin | Remove image |
| GET | /api/polls/:pollId/share | admin | Get/regenerate share token |
| GET | /api/polls/view/:pollId | none | Public view (no adminToken) |
| GET | /api/polls/:pollId/pairings | none | Get next pair for voter |
| POST | /api/polls/:pollId/vote | none | Submit vote selection |
| GET | /api/polls/:pollId/results | admin | Aggregated results |
| GET | /api/polls/:pollId/voters | admin | Anonymized voter list |

## Pairing Algorithm

1. For N images and R rounds, each voter sees R pairs.
2. Build a round-robin tournament schedule for all image pairs.
3. Shuffle and select R unique pairs ensuring each image appears ~equally.
4. Each voter gets the same deterministic shuffled sequence (seeded by poll id + voter fingerprint).
5. Pairs are stored per-round; left/right randomization per voter.

## Security

- Rate limit: 60 req/min per IP (express-rate-limit)
- Upload limit: max 20 images per poll, 10 MB each
- Admin routes protected by `x-admin-token` header
- Share admin panel: separate `shareToken` that exposes metadata read-only
- No sensitive data in URLs (tokens via headers/body)
- Uploaded content sanitized (only image/* mime)

## Storage

All data stored locally:
- `data/polls/` — one JSON file per poll
- `data/uploads/` — uploaded images (served statically)
- `data/votes.json` — all votes

## Frontend Pages

1. **Home** `/` — "Create Poll" button → POST /api/polls → redirect to `/admin/:id?token=X`
2. **Admin** `/admin/:id` — drag-drop upload, title/desc/rounds config, container size editor, share buttons, metadata tab
3. **Vote** `/vote/:id` — title, description, Start button, pair display with smack animation, progress bar
4. **Metadata** (tab inside admin) — voter table with expandable selections

## Animations

- Winner "smacks" loser: winner scales to 1.15x and translates slightly toward loser, loser translates down+back and fades, then both reset for next pair.
- CSS transition 0.4s ease-out.
