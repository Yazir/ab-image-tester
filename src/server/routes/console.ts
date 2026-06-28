import { Router, Request, Response } from 'express';
import {
  getConsoleOverview,
  getVotesByDay,
  getPollsSummary,
  getStorageStats,
  getDbTables,
  executeReadOnlyQuery,
  getPoll,
} from '../store';
import { requireConsoleKey, consoleEnabled, getConsoleKey } from '../middleware/consoleAuth';

const router = Router();

router.use(requireConsoleKey);

router.get('/auth-check', (_req: Request, res: Response) => {
  res.json({ enabled: consoleEnabled() });
});

router.get('/overview', (_req: Request, res: Response) => {
  const overview = getConsoleOverview();
  res.json(overview);
});

router.get('/usage', (_req: Request, res: Response) => {
  const usage = getVotesByDay();
  res.json(usage);
});

router.get('/polls', (req: Request, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  const search = q.search || undefined;
  const sortBy = q.sortBy || undefined;
  const sortDir = q.sortDir || undefined;
  const polls = getPollsSummary(search, sortBy, sortDir);
  res.json(polls);
});

router.get('/polls/:pollId', (req: Request, res: Response) => {
  const poll = getPoll(req.params.pollId as string);
  if (!poll) return res.status(404).json({ error: 'Poll not found' });
  const { adminToken, shareToken, ...safePoll } = poll as any;
  res.json(safePoll);
});

router.get('/storage', (_req: Request, res: Response) => {
  const stats = getStorageStats();
  res.json(stats);
});

router.get('/db/tables', (_req: Request, res: Response) => {
  const tables = getDbTables();
  res.json(tables);
});

router.post('/db/query', (req: Request, res: Response) => {
  const { sql, params } = req.body;
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'SQL query is required' });
  }
  if (params && !Array.isArray(params)) {
    return res.status(400).json({ error: 'Params must be an array' });
  }
  try {
    const result = executeReadOnlyQuery(sql, params);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Query failed' });
  }
});

export default router;
