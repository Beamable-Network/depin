import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['features/**/*.test.ts'],
    testTimeout: 60000
  },
});