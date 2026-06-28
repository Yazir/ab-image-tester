import { Router, Request, Response } from 'express';
import { getPoll, getVotesForPoll } from '../store';
import { requireAdminOrShare } from '../middleware/auth';
import { Selection } from '../../shared/types';

const router = Router();

const animals = [
  'Fox', 'Owl', 'Bear', 'Wolf', 'Hawk', 'Lynx', 'Elk', 'Raven',
  'Otter', 'Badger', 'Falcon', 'Heron', 'Marten', 'Viper', 'Bison',
  'Crane', 'Stoat', 'Puma', 'Condor', 'Tapir', 'Okapi', 'Saiga',
  'Fossa', 'Quoll', 'Serval', 'Caracal', 'Margay', 'Colugo', 'Numbat',
];

function anonName(fingerprint: string): string {
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    hash = ((hash << 5) - hash + fingerprint.charCodeAt(i)) | 0;
  }
  return animals[Math.abs(hash) % animals.length] + '-' + Math.abs(hash % 1000).toString().padStart(3, '0');
}

// Get all voters
router.get('/:pollId/voters', requireAdminOrShare, (req: Request, res: Response) => {
  const poll = getPoll(req.params.pollId);
  if (!poll) return res.status(404).json({ error: 'Not found' });

  const votes = getVotesForPoll(poll.id);
  const voters = votes.map(v => ({
    name: anonName(v.voterFingerprint),
    fingerprint: v.voterFingerprint.slice(0, 8),
    votedAt: v.votedAt,
    selections: v.selections.map(s => ({
      round: s.round,
      leftImageId: s.leftImageId,
      rightImageId: s.rightImageId,
      winnerId: s.winnerId,
    })),
  }));

  res.json({ voters, total: voters.length });
});

// Get aggregated results
router.get('/:pollId/results', requireAdminOrShare, (req: Request, res: Response) => {
  const poll = getPoll(req.params.pollId);
  if (!poll) return res.status(404).json({ error: 'Not found' });

  const votes = getVotesForPoll(poll.id);
  const imageStats: Record<string, { wins: number; appearances: number }> = {};

  for (const img of poll.images) {
    imageStats[img.id] = { wins: 0, appearances: 0 };
  }

  for (const vote of votes) {
    for (const sel of vote.selections) {
      if (imageStats[sel.leftImageId]) imageStats[sel.leftImageId].appearances++;
      if (imageStats[sel.rightImageId]) imageStats[sel.rightImageId].appearances++;
      if (imageStats[sel.winnerId]) imageStats[sel.winnerId].wins++;
    }
  }

  res.json({
    poll: { id: poll.id, title: poll.title, description: poll.description, images: poll.images, rounds: poll.rounds },
    totalVotes: votes.length,
    imageStats,
  });
});

export default router;
