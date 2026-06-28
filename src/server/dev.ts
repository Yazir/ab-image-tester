import { createServer as createViteServer } from 'vite';
import { createApp, errorHandler, closeDatabase } from './app';

const PORT = process.env.PORT || 3000;

async function start() {
  const app = createApp({ isDev: true });

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  app.use(vite.middlewares);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(errorHandler);

  const server = app.listen(PORT, () => {
    console.log(`Dev server running at http://localhost:${PORT}`);
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
}

start();
