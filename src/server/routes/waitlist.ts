import { Router, Request, Response } from 'express';
import { addWaitlistEmail } from '../store';
import { waitlistLimiter } from '../middleware/rateLimit';

const router = Router();

router.post('/', waitlistLimiter, (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 254) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  addWaitlistEmail(email);
  res.status(200).json({ ok: true });
});

export default router;
