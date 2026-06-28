import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      TEST_DATA_DIR: path.resolve(__dirname, 'data-test'),
    },
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
