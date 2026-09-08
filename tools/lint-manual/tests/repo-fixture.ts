import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A throwaway checkout the collector can walk. */
export function makeRepo(files: Record<string, string>): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'lint-manual-'));
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** The smallest tree that satisfies every rule. */
export const MINIMAL: Record<string, string> = {
  'services/app/tests/manual/readme.md':
    '# Manual tests\n\n## The suites\n\n| Suite |\n|---|\n| [smoke](suites/smoke.md) |\n',
  'services/app/tests/manual/setup.md': '# Setup\n',
  'services/app/tests/manual/template.md': '# Template\n',
  'services/app/tests/manual/suites/smoke.md':
    '# Smoke\n\n> **Prefix** `SMOKE-` · **Reset** none · **Cost** 1m\n\n- [ ] `SMOKE-1` · **Open it** → it renders.\n',
  'services/app/tests/manual/reference/automation.md': '# Automation\n',
  'services/app/tests/manual/reference/error-codes.md': '# Codes\n',
  'services/app/tests/manual/reference/not-a-finding.md': '# Not a finding\n',
  'services/app/tests/manual/reference/pins.md': '# Pins\n',
  'services/app/tests/manual/runs/readme.md': '# The round journal\n',
  'services/app/tests/manual/runs/template.md': '# R<n>\n',
  'services/app/tests/manual/runs/template-session-log.md': '# Session log\n',
};
