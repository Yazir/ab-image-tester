import { Request, Response, NextFunction } from 'express';
import { getPoll } from '../store';

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const pollId = req.params.pollId as string;
  const token = req.headers['x-admin-token'] as string;
  if (!pollId || !token) {
    return res.status(401).json({ error: 'Missing auth' });
  }
  const poll = getPoll(pollId);
  if (!poll || poll.adminToken !== token) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

export function requireAdminOrShare(req: Request, res: Response, next: NextFunction) {
  const pollId = req.params.pollId as string;
  const token = (req.headers['x-admin-token'] || req.headers['x-share-token']) as string;
  if (!pollId || !token) {
    return res.status(401).json({ error: 'Missing auth' });
  }
  const poll = getPoll(pollId);
  if (!poll) return res.status(404).json({ error: 'Poll not found' });
  if (poll.adminToken === token) return next();
  if (poll.shareToken && poll.shareToken === token) return next();
  return res.status(403).json({ error: 'Forbidden' });
}
