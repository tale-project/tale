#!/usr/bin/env bun
// =============================================================================
// Tale — Master E2E Test Suite
// =============================================================================
// Invokes existing Vitest (server + UI) tests via the project's test scripts.
// New E2E tests will be added in Phase 2.
//
// Usage: bun tests/master-e2e-test.ts
// =============================================================================
import { projectRoot, stream } from './lib/exec';
import { BOLD, GREEN, NC, RED, section } from './lib/log';

const PROJECT_ROOT = projectRoot();

interface SuiteResult {
  name: string;
  status: 'PASS' | 'FAIL';
  dur: number;
}

const results: SuiteResult[] = [];
let passed = 0;
let failed = 0;
const startTime = Date.now();

function header(title: string): void {
  console.log('');
  console.log(
    `${BOLD}╔══════════════════════════════════════════════════╗${NC}`,
  );
  console.log(`${BOLD}║  ${title}${BOLD}  ║${NC}`);
  console.log(
    `${BOLD}╚══════════════════════════════════════════════════╝${NC}`,
  );
  console.log('');
}

async function runSuite(
  name: string,
  label: string,
  cmd: string[],
): Promise<void> {
  section(`Running: ${label}`);
  const svcStart = Date.now();
  const code = await stream(cmd, { cwd: `${PROJECT_ROOT}/services/platform` });
  const dur = Math.round((Date.now() - svcStart) / 1000);
  if (code === 0) {
    console.log(`  ${GREEN}✓${NC} ${name} passed (${dur}s)`);
    results.push({ name, status: 'PASS', dur });
    passed++;
  } else {
    console.log(`  ${RED}✗${NC} ${name} failed (${dur}s)`);
    results.push({ name, status: 'FAIL', dur });
    failed++;
  }
}

console.log('');
console.log(
  `${BOLD}╔══════════════════════════════════════════════════════════╗${NC}`,
);
console.log(
  `${BOLD}║         Tale — Master E2E Test Suite                    ║${NC}`,
);
console.log(
  `${BOLD}╚══════════════════════════════════════════════════════════╝${NC}`,
);

// 1. Vitest — Server Tests (Convex, Libs, Utils)
header('Vitest — Server Tests                    ');
await runSuite('Vitest:Server', 'bunx vitest --run --project server', [
  'bunx',
  'vitest',
  '--run',
  '--project',
  'server',
]);

// 2. Vitest — UI Component Tests (jsdom)
header('Vitest — UI Component Tests              ');
await runSuite('Vitest:UI', 'bunx vitest --run --config vitest.ui.config.ts', [
  'bunx',
  'vitest',
  '--run',
  '--config',
  'vitest.ui.config.ts',
]);

// FINAL SUMMARY
const totalTime = Math.round((Date.now() - startTime) / 1000);
const total = passed + failed;

console.log('');
console.log(
  `${BOLD}╔══════════════════════════════════════════════════════════╗${NC}`,
);
console.log(
  `${BOLD}║              MASTER E2E TEST RESULTS                    ║${NC}`,
);
console.log(
  `${BOLD}╠══════════════════════════════════════════════════════════╣${NC}`,
);

for (const { name, status, dur } of results) {
  const padded = name.padEnd(15);
  if (status === 'PASS') {
    console.log(`  ${GREEN}✅ ${padded}${NC} PASSED  (${dur}s)`);
  } else {
    console.log(`  ${RED}❌ ${padded}${NC} FAILED  (${dur}s)`);
  }
}

console.log(
  `${BOLD}╠══════════════════════════════════════════════════════════╣${NC}`,
);
console.log(
  `  Suites: ${total}  |  ${GREEN}Passed: ${passed}${NC}  |  ${RED}Failed: ${failed}${NC}  |  ⏱  ${totalTime}s`,
);

if (failed === 0) {
  console.log('');
  console.log(`  ${GREEN}${BOLD}🎉 ALL TEST SUITES PASSED${NC}`);
}

console.log(
  `${BOLD}╚══════════════════════════════════════════════════════════╝${NC}`,
);
console.log('');

process.exit(failed === 0 ? 0 : 1);
