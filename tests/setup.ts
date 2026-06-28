import fs from 'fs';

const dataDir = process.env.TEST_DATA_DIR!;
if (fs.existsSync(dataDir)) {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
