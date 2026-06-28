import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { getPoll, getVotesForPoll, getVotesForVoter, saveVote } from '../store';
import { Pairing, Selection, Image } from '../../shared/types';
import { voteLimiter } from '../middleware/rateLimit';
import { computeResults } from '../results';

function loadVoterSecret(): string {
  const DATA_DIR = process.env.TEST_DATA_DIR || path.resolve(__dirname, '../../../data');
  const secretPath = path.join(DATA_DIR, '.voter_secret');
  try {
    return fs.readFileSync(secretPath, 'utf-8').trim() || '';
  } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  const dir = path.dirname(secretPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

const VOTER_SECRET = loadVoterSecret();

const router = Router();

function signFingerprint(pollId: string, fingerprint: string): string {
  const mac = crypto.createHmac('sha256', VOTER_SECRET);
  mac.update(`${pollId}:${fingerprint}`);
  return mac.digest('hex').slice(0, 16);
}

function verifySignature(pollId: string, fingerprint: string, signature: string): boolean {
  const expected = signFingerprint(pollId, fingerprint);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function parseVoterToken(raw: string): { pollId: string; fingerprint: string; valid: boolean } | null {
  try {
    const parts = raw.split('.');
    if (parts.length !== 3) return null;
    const [pollId, fingerprint, sig] = parts;
    const valid = verifySignature(pollId, fingerprint, sig);
    return { pollId, fingerprint, valid };
  } catch {
    return null;
  }
}

export function issueVoterToken(pollId: string, fingerprint: string): string {
  const sig = signFingerprint(pollId, fingerprint);
  return `${pollId}.${fingerprint}.${sig}`;
}

function seededShuffle<T>(arr: T[], seed: string): T[] {
  const result = [...arr];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  let s = Math.abs(hash) || 1;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function generatePairings(pollId: string, voterFingerprint: string, rounds: number, images: Image[]): Pairing[] {
  const n = images.length;
  if (n < 2) return [];

  const totalRounds = Math.min(rounds, Math.floor(n * (n - 1) / 2));
  const allPairs: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      allPairs.push([i, j]);
    }
  }

  const seed = `${pollId}:${voterFingerprint}`;
  const shuffled = seededShuffle(allPairs, seed);

  const appearances = new Array(n).fill(0);
  const available = [...shuffled];
  const selected: [number, number][] = [];

  for (let round = 0; round < totalRounds; round++) {
    let bestIdx = 0;
    let bestScore = Infinity;
    for (let k = 0; k < available.length; k++) {
      const [a, b] = available[k];
      const score = appearances[a] + appearances[b];
      if (score < bestScore) {
        bestScore = score;
        bestIdx = k;
      }
    }
    const pair = available.splice(bestIdx, 1)[0];
    appearances[pair[0]]++;
    appearances[pair[1]]++;
    selected.push(pair);
  }

  return selected.map((pair, idx) => {
    const leftRightSeed = `${seed}:round:${idx}`;
    let hash = 0;
    for (let i = 0; i < leftRightSeed.length; i++) {
      hash = ((hash << 5) - hash + leftRightSeed.charCodeAt(i)) | 0;
    }
    const swap = (Math.abs(hash) % 2) === 0;
    const [l, r] = pair;
    return {
      left: swap ? images[r] : images[l],
      right: swap ? images[l] : images[r],
      round: idx,
    };
  });
}

function validateSelections(pairings: Pairing[], selections: Selection[]): boolean {
  if (selections.length !== pairings.length) return false;
  for (let i = 0; i < pairings.length; i++) {
    const p = pairings[i];
    const s = selections[i];
    if (s.round !== p.round) return false;
    const actualIds = new Set([p.left.id, p.right.id]);
    if (!actualIds.has(s.leftImageId)) return false;
    if (!actualIds.has(s.rightImageId)) return false;
    if (!actualIds.has(s.winnerId)) return false;
  }
  return true;
}

// Public aggregated results — no auth required
router.get('/:pollId/results', (req: Request, res: Response) => {
  const poll = getPoll(req.params.pollId as string);
  if (!poll) return res.status(404).json({ error: 'Not found' });
  if (!poll.showResults) return res.status(403).json({ error: 'Results are not available for this poll' });

  const votes = getVotesForPoll(poll.id);
  res.json(computeResults(poll, votes));
});

// CSRF check middleware
function csrfCheck(req: Request, res: Response, next: Function) {
  const origin = req.headers['origin'];
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
    return res.status(403).json({ error: 'Cross-origin requests not allowed' });
  }
  next();
}

// Get pairings for voter
router.get('/:pollId/pairings', voteLimiter, (req: Request, res: Response) => {
  const poll = getPoll(req.params.pollId as string);
  if (!poll) return res.status(404).json({ error: 'Not found' });
  if (poll.images.length < 2) return res.status(400).json({ error: 'Need at least 2 images' });

  let fingerprint: string;
  const tokenHeader = req.headers['x-voter-token'] as string;

  if (tokenHeader) {
    const parsed = parseVoterToken(tokenHeader);
    if (!parsed || !parsed.valid || parsed.pollId !== poll.id) {
      return res.status(403).json({ error: 'Invalid voter token' });
    }
    fingerprint = parsed.fingerprint;
  } else {
    fingerprint = (req.headers['x-voter-fingerprint'] as string) || '';
    if (!fingerprint) return res.status(400).json({ error: 'Missing voter fingerprint' });
  }

  const existing = getVotesForVoter(poll.id, fingerprint);
  if (existing) {
    return res.status(409).json({ error: 'Already voted', selections: existing.selections });
  }

  const pairings = generatePairings(poll.id, fingerprint, poll.rounds, poll.images);
  const voterToken = issueVoterToken(poll.id, fingerprint);
  res.json({ pairings, totalRounds: pairings.length, voterToken });
});

// Submit vote
router.post('/:pollId/vote', csrfCheck, voteLimiter, (req: Request, res: Response) => {
  const poll = getPoll(req.params.pollId as string);
  if (!poll) return res.status(404).json({ error: 'Not found' });

  const tokenHeader = req.headers['x-voter-token'] as string;
  if (!tokenHeader) return res.status(400).json({ error: 'Missing voter token. Request pairings first.' });

  const parsed = parseVoterToken(tokenHeader);
  if (!parsed || !parsed.valid || parsed.pollId !== poll.id) {
    return res.status(403).json({ error: 'Invalid voter token.' });
  }

  const fingerprint = parsed.fingerprint;

  const existing = getVotesForVoter(poll.id, fingerprint);
  if (existing) {
    return res.status(409).json({ error: 'Already voted' });
  }

  const { selections } = req.body as { selections: Selection[] };
  if (!Array.isArray(selections) || selections.length === 0) {
    return res.status(400).json({ error: 'No selections provided' });
  }

  const pairings = generatePairings(poll.id, fingerprint, poll.rounds, poll.images);
  if (!validateSelections(pairings, selections)) {
    return res.status(400).json({ error: 'Selections do not match expected pairings' });
  }

  const vote = {
    id: uuid(),
    pollId: poll.id,
    voterFingerprint: fingerprint,
    selections,
    votedAt: Date.now(),
  };

  saveVote(vote);
  res.status(201).json({ ok: true });
});

// Check if voter has already voted
router.get('/:pollId/voted', (req: Request, res: Response) => {
  const poll = getPoll(req.params.pollId as string);
  if (!poll) return res.status(404).json({ error: 'Not found' });

  const fingerprint = (req.headers['x-voter-fingerprint'] as string) || '';
  if (!fingerprint) return res.status(400).json({ error: 'Missing voter fingerprint' });

  const existing = getVotesForVoter(poll.id, fingerprint);
  res.json({ voted: !!existing });
});

export default router;
