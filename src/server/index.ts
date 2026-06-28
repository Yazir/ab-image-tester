import express from 'express';
import path from 'path';
import fs from 'fs';
import { createApp, errorHandler, closeDatabase } from './app';

const app = createApp();
const PORT = process.env.PORT || 3000;

const viteClientDir = path.resolve(__dirname, '../client');
const legacyPublicDir = path.resolve(__dirname, '../../public');
const staticDir = fs.existsSync(path.join(viteClientDir, 'index.html')) ? viteClientDir : legacyPublicDir;

app.use(express.static(staticDir, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));

app.get('/js/{*path}', (req, res, next) => {
  const filePath = path.join(staticDir, req.path);
  const safe = path.resolve(filePath);
  if (!safe.startsWith(staticDir)) return next();
  if (!path.extname(filePath) && fs.existsSync(filePath + '.js')) {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.sendFile(filePath + '.js');
  }
  next();
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.get('/admin/{*path}', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.get('/vote/{*path}', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.get('/console', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`AB Image Tester running at http://localhost:${PORT}`);
});

function shutdown() {
  console.log('\nShutting down...');
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
