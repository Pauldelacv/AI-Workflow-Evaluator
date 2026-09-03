import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // tsconfig keeps `jsx: preserve` for Next's compiler, so Vitest's esbuild
  // needs to be told to use the automatic runtime for component tests.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Component tests opt into jsdom with a `@vitest-environment jsdom` docblock.
    globals: true,
    // The run store writes to disk; tests point it at a temp dir per file.
    pool: 'forks',
  },
});
