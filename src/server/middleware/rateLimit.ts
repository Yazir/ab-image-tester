import { rateLimit } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
});

export const voteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Voting too fast.' },
});

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();
const UPLOAD_REFILL_RATE = 2;
const MAX_BUCKETS = 10_000;

setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now - b.lastRefill > 120_000) {
      buckets.delete(key);
    }
  }
}, 60_000);

export function createUploadLeakyBucket(maxImages: number) {
  const capacity = maxImages;

  return function uploadLeakyBucket(req: Request, res: Response, next: NextFunction) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket) {
      if (buckets.size >= MAX_BUCKETS) {
        return res.status(429).json({ error: 'Service busy. Try again later.' });
      }
      bucket = { tokens: capacity, lastRefill: now };
      buckets.set(key, bucket);
    } else {
      const elapsed = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * UPLOAD_REFILL_RATE);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      next();
    } else {
      res.status(429).json({ error: 'Upload rate limit exceeded. Slow down.' });
    }
  };
}

interface IPBan {
  failures: number;
  bannedUntil: number;
}

const pollKeyBans = new Map<string, IPBan>();
const MAX_POLL_KEY_FAILURES = 5;
const POLL_KEY_BAN_MS = 60 * 60 * 1000;
const MAX_POLL_BAN_ENTRIES = 20_000;

setInterval(() => {
  const now = Date.now();
  for (const [key, ban] of pollKeyBans) {
    if (ban.bannedUntil && now > ban.bannedUntil) {
      pollKeyBans.delete(key);
    }
  }
}, 60_000);

export function createPollGuard(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = pollKeyBans.get(ip);

  if (entry && entry.bannedUntil && now < entry.bannedUntil) {
    const remaining = Math.ceil((entry.bannedUntil - now) / 60000);
    return res.status(429).json({ error: `Too many attempts. Try again in ${remaining} min.` });
  }

  next();
}

export function recordPollKeyFailure(ip: string): void {
  const now = Date.now();
  let entry = pollKeyBans.get(ip);

  if (!entry) {
    if (pollKeyBans.size >= MAX_POLL_BAN_ENTRIES) return;
    entry = { failures: 0, bannedUntil: 0 };
    pollKeyBans.set(ip, entry);
  }

  if (entry.bannedUntil && now > entry.bannedUntil) {
    entry.failures = 0;
    entry.bannedUntil = 0;
  }

  entry.failures++;

  if (entry.failures >= MAX_POLL_KEY_FAILURES) {
    entry.bannedUntil = now + POLL_KEY_BAN_MS;
  }
}

export function clearPollKeyFailures(ip: string): void {
  pollKeyBans.delete(ip);
}

export const waitlistLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Try again later.' },
});
