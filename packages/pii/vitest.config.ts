import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Vitest configuration for @tale/pii.
//
// The suite mixes:
//   - co-located unit tests at `src/**/*.test.ts` (engine + patterns)
//   - top-level integration tests at `test/**/*.test.ts` (data-driven fixtures,
//     ReDoS, Unicode normalization, throughput)
//
// JSON fixtures under `test/fixtures/**` are loaded at runtime by
// `test/data-driven.test.ts`; they are explicitly excluded from `include`
// because they are data, not tests.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // 100k+ data-driven cases — disable per-test isolation to amortize
    // pre-built Scrubber across cases. The detector is pure; tests do not
    // share mutable state.
    isolate: false,
  },
});
