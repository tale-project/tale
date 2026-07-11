import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HOOK = resolve(import.meta.dir, '../../tale-vision-read-hook');

let workDir: string;
let binDir: string;

beforeEach(() => {
  workDir = realpathSync(mkdtempSync(`${tmpdir()}/vision-hook-`));
  binDir = join(workDir, 'bin');
  spawnSync('mkdir', ['-p', binDir], { encoding: 'utf8' });
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const readPayload = (filePath: string) =>
  JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: filePath },
  });

const runHook = (filePath: string, env: Record<string, string | undefined>) => {
  const res = spawnSync('bash', [HOOK], {
    input: readPayload(filePath),
    env: {
      ...process.env,
      ...env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
    encoding: 'utf8',
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
};

const writeFake = (name: string, body: string) => {
  const path = join(binDir, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
};

const denyReason = (stdout: string): string => {
  const out = JSON.parse(stdout);
  expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  const reason: unknown = out.hookSpecificOutput.permissionDecisionReason;
  expect(typeof reason).toBe('string');
  if (typeof reason !== 'string') {
    throw new Error('expected permissionDecisionReason string');
  }
  return reason;
};

describe('tale-vision-read-hook', () => {
  test('no-op without TALE_VISION_MODEL (PDF and image)', () => {
    const pdf = join(workDir, 'doc.pdf');
    writeFileSync(pdf, '%PDF-1.4');
    const { status, stdout } = runHook(pdf, { TALE_VISION_MODEL: undefined });
    expect(status).toBe(0);
    expect(stdout.trim()).toBe('');

    const png = join(workDir, 'x.png');
    writeFileSync(png, 'not-a-real-png');
    const img = runHook(png, { TALE_VISION_MODEL: '' });
    expect(img.status).toBe(0);
    expect(img.stdout.trim()).toBe('');
  });

  test('PDF with extractable text: deny + pdftotext body + rasterize hint', () => {
    writeFake(
      'pdftotext',
      `#!/bin/bash
# fake: ignore args, emit enough text to pass the 40-char compact threshold
cat <<'EOF'
Invoice number INV-2026-001
Supplier: Marmi Stone AG
Net amount CHF 1'250.00
VAT 8.1% CHF 101.25
EOF
`,
    );
    const pdf = join(workDir, 'invoice.pdf');
    writeFileSync(pdf, '%PDF-fake');

    const { status, stdout } = runHook(pdf, {
      TALE_VISION_MODEL: 'openai/gpt-4o',
    });
    expect(status).toBe(0);
    const reason = denyReason(stdout);
    expect(reason).toContain('cannot ingest PDF file blocks');
    expect(reason).toContain('INV-2026-001');
    expect(reason).toContain('pdftoppm');
    expect(reason).toContain('Do NOT Read the .pdf again');
  });

  test('PDF with little/no text: deny + scan guidance only', () => {
    writeFake(
      'pdftotext',
      `#!/bin/bash
# empty / whitespace-only extraction (scan PDF)
printf '\\f\\n  \\n'
`,
    );
    const pdf = join(workDir, 'scan.pdf');
    writeFileSync(pdf, '%PDF-fake');

    const { status, stdout } = runHook(pdf, {
      TALE_VISION_MODEL: 'openai/gpt-4o',
    });
    expect(status).toBe(0);
    const reason = denyReason(stdout);
    expect(reason).toContain('little or no text');
    expect(reason).toContain('pdftoppm');
    expect(reason).not.toContain('Extracted text from this PDF');
  });

  test('PDF when pdftotext missing: deny + rasterize guidance', () => {
    // Shadow real pdftotext with a non-executable name so command -v fails…
    // Actually PATH has binDir first; omit pdftotext entirely and strip system
    // by using PATH=binDir only (plus needed shells via absolute bash already).
    const pdf = join(workDir, 'alone.pdf');
    writeFileSync(pdf, '%PDF-fake');

    const res = spawnSync('bash', [HOOK], {
      input: readPayload(pdf),
      env: {
        ...process.env,
        TALE_VISION_MODEL: 'openai/gpt-4o',
        // Empty PATH except nothing — command -v pdftotext fails; jq must still
        // resolve. Keep a minimal PATH with jq's dir.
        PATH: (() => {
          const jq = spawnSync('bash', ['-lc', 'command -v jq'], {
            encoding: 'utf8',
          });
          const jqDir = resolve(jq.stdout.trim(), '..');
          return jqDir;
        })(),
      },
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    const reason = denyReason(res.stdout);
    expect(reason).toContain('little or no text');
    expect(reason).toContain('pdftoppm');
  });

  test('image Read: deny with transcribed text on success', () => {
    writeFake(
      'tale-vision-transcribe',
      `#!/bin/bash
echo "Receipt total: 42.00 CHF"
exit 0
`,
    );
    const png = join(workDir, 'receipt.png');
    writeFileSync(png, 'fake');

    const { status, stdout } = runHook(png, {
      TALE_VISION_MODEL: 'openai/gpt-4o',
    });
    expect(status).toBe(0);
    const reason = denyReason(stdout);
    expect(reason).toContain('cannot see images');
    expect(reason).toContain('Receipt total: 42.00 CHF');
  });

  test('image Read: deny with diagnostic when transcribe fails', () => {
    writeFake(
      'tale-vision-transcribe',
      `#!/bin/bash
echo "gateway 502" >&2
exit 1
`,
    );
    const jpg = join(workDir, 'x.jpg');
    writeFileSync(jpg, 'fake');

    const { status, stdout } = runHook(jpg, {
      TALE_VISION_MODEL: 'openai/gpt-4o',
    });
    expect(status).toBe(0);
    const reason = denyReason(stdout);
    expect(reason).toContain('could not read this image');
    expect(reason).toContain('gateway 502');
  });

  test('non-image non-PDF is a no-op even with vision model set', () => {
    const md = join(workDir, 'notes.md');
    writeFileSync(md, '# hi');
    const { status, stdout } = runHook(md, {
      TALE_VISION_MODEL: 'openai/gpt-4o',
    });
    expect(status).toBe(0);
    expect(stdout.trim()).toBe('');
  });
});
