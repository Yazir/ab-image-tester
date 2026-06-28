import express from 'express';
import path from 'path';
import fs from 'fs';
import pollRoutes from './routes/poll';
import voteRoutes from './routes/vote';
import adminRoutes from './routes/admin';
import { generalLimiter } from './middleware/rateLimit';
import { close as closeDb } from './store';

export function createApp({ isDev } = { isDev: false }): express.Application {
  const app = express();

  function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    const csp = isDev
      ? "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws:"
      : "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'sha256-90k8vHqdT80Brtxlv3oFi8HQh4+vdtyWQb8gjs8xgiY='; connect-src 'self'";
    res.setHeader('Content-Security-Policy', csp);
    next();
  }

  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(express.json({ limit: '1mb' }));
  app.use(generalLimiter);

  app.use('/api/polls', pollRoutes);
  app.use('/api/polls', voteRoutes);
  app.use('/api/polls', adminRoutes);

  const DATA_DIR = process.env.TEST_DATA_DIR || path.resolve(__dirname, '../../data');
  const uploadsDir = path.join(DATA_DIR, 'uploads');

  const VALID_UPLOAD_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
  const EXT_TO_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };

  app.use('/uploads', (req, res, next) => {
    const ext = path.extname(req.path).toLowerCase();
    if (!VALID_UPLOAD_EXTS.has(ext)) {
      return res.status(403).json({ error: 'Not found' });
    }
    next();
  });

  const uploadsAbsDir = path.resolve(__dirname, '../../data/uploads');
  if (!fs.existsSync(uploadsAbsDir)) fs.mkdirSync(uploadsAbsDir, { recursive: true });

  app.use('/uploads', express.static(uploadsDir, {
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (EXT_TO_MIME[ext]) {
        res.setHeader('Content-Type', EXT_TO_MIME[ext]);
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
    dotfiles: 'deny',
  }));

  return app;
}

export function errorHandler(err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) {
  if (process.env.NODE_ENV !== 'production') console.error(err);
  else console.error(err.message || 'Unknown error');
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Max 10 MB.' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field.' });
  }
  if (err.message && (err.message.startsWith('Only ') || err.message === 'Only images allowed')) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Internal server error' });
}

export function closeDatabase(): void {
  closeDb();
}
