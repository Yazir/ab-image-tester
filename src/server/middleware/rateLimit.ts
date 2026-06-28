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
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Voting too fast.' },
});

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();
const UPLOAD_CAPACITY = 30;
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

export function uploadLeakyBucket(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) {
      return res.status(429).json({ error: 'Service busy. Try again later.' });
    }
    bucket = { tokens: UPLOAD_CAPACITY, lastRefill: now };
    buckets.set(key, bucket);
  } else {
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(UPLOAD_CAPACITY, bucket.tokens + elapsed * UPLOAD_REFILL_RATE);
    bucket.lastRefill = now;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    next();
  } else {
    res.status(429).json({ error: 'Upload rate limit exceeded. Slow down.' });
  }
}
