import { Request, Response, NextFunction } from 'express';

const CONSOLE_KEY = process.env.CONSOLE_KEY || '';

export function consoleEnabled(): boolean {
  return CONSOLE_KEY.length > 0;
}

export function requireConsoleKey(req: Request, res: Response, next: NextFunction) {
  if (!CONSOLE_KEY) {
    return res.status(404).json({ error: 'Console disabled' });
  }
  const key = (req.headers['x-console-key'] || req.headers['x-admin-key']) as string;
  if (!key) {
    return res.status(401).json({ error: 'Missing console key' });
  }
  if (key !== CONSOLE_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

export function getConsoleKey(): string {
  return CONSOLE_KEY;
}
