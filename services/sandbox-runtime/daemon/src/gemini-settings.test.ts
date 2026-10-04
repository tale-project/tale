import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  geminiPayload,
  installGeminiWrapper,
} from './gemini-settings-test-helper';

const pyTest = spawnSync('python3', ['-V']).status === 0 ? test : test.skip;
let root: string;
let wrapper: string;

const FAKE_CLI = `#!/usr/bin/env python3
import json, os, pathlib, stat, sys
p = pathlib.Path(os.environ["GEMINI_CLI_SYSTEM_SETTINGS_PATH"])
context = pathlib.Path(os.environ["HOME"]) / ".gemini" / os.environ["TALE_GEMINI_CONTEXT_FILE"]
print(json.dumps({"settings": json.loads(p.read_text()), "path": str(p), "prompt": sys.stdin.read(), "argv": sys.argv[1:], "bridge": os.environ.get("TALE_GEMINI_BRIDGE_URL"), "context": context.read_text() if context.exists() else None, "mode": stat.S_IMODE(context.stat().st_mode) if context.exists() else None}))
sys.exit(int(os.environ.get("FAKE_EXIT", "0")))
`;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tale-gemini-settings-')));
  for (const dir of ['workspace', 'home']) mkdirSync(join(root, dir));
  wrapper = installGeminiWrapper(root);
  writeFileSync(join(root, 'bin/gemini'), FAKE_CLI);
  chmodSync(join(root, 'bin/gemini'), 0o755);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(payload: string, exit = '0') {
  return spawnSync('python3', [wrapper, '--workdir', join(root, 'workspace')], {
    input: payload,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      HOME: join(root, 'home'),
      FAKE_EXIT: exit,
    },
  });
}

describe('Gemini immutable system settings', () => {
  test('derives six distinct policy shapes from the existing harness interpreter', () => {
    const dir = join(root, 'share/tale/gemini-settings');
    expect(readdirSync(dir).length).toBe(6);
    for (const name of readdirSync(dir)) {
      const policy = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      expect(name).toMatch(/^[a-f\d]{64}\.json$/);
      expect(policy).toMatchObject({
        model: { maxSessionTurns: 200 },
        context: { fileName: ['GEMINI.md', '${TALE_GEMINI_CONTEXT_FILE}'] },
      });
    }
  });

  pyTest(
    'keeps managed policy immutable while passing only per-exec strings through env',
    () => {
      const bridge = 'https://platform.invalid/bridge?q="ü"';
      const result = run(
        geminiPayload(root, {
          prompt: '-private prompt',
          instructions: 'private instructions',
          managed: true,
          browser: true,
          bridgeUrl: bridge,
        }),
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const observed = JSON.parse(result.stdout);
      expect(observed).toMatchObject({
        prompt: '-private prompt',
        context: 'private instructions',
        mode: 0o600,
        bridge,
        settings: {
          security: { auth: { selectedType: 'gemini-api-key' } },
          tools: { exclude: ['google_web_search', 'web_fetch'] },
          mcpServers: {
            connectors: {
              env: {
                TALE_CONNECTORS_URL: '${TALE_GEMINI_BRIDGE_URL}',
                TALE_CONNECTORS_TOKEN: '${TALE_GATEWAY_TOKEN}',
              },
            },
          },
        },
      });
      expect(observed.path).toStartWith(
        join(root, 'share/tale/gemini-settings/'),
      );
      expect(observed.argv).not.toContain('-private prompt');
      expect(result.stdout).not.toContain('private-token');
      expect(readdirSync(join(root, 'home/.gemini'))).toEqual([]);
    },
  );

  pyTest('leaves BYO native tools and authentication inference intact', () => {
    const result = run(geminiPayload(root, { instructions: null }));
    expect(result.status).toBe(0);
    const observed = JSON.parse(result.stdout);
    expect(observed.settings).not.toHaveProperty('security');
    expect(observed.settings).not.toHaveProperty('tools');
    expect(observed.settings).not.toHaveProperty('mcpServers');
    expect(observed.context).toBeNull();
  });

  pyTest.each([
    { model: { maxSessionTurns: -1 } },
    { tools: { exclude: [] } },
    {
      mcpServers: {
        connectors: {
          command: 'untrusted',
          env: { TALE_CONNECTORS_URL: 'https://wrong.invalid' },
        },
      },
    },
  ])('refuses policy drift before launching the CLI: %j', (override) => {
    const payload = JSON.parse(geminiPayload(root));
    Object.assign(payload.settings, override);
    const result = run(JSON.stringify(payload));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('settings do not match this sandbox image');
    expect(result.stdout).not.toContain('"argv"');
  });

  pyTest(
    'returns the CLI exit code and cleans private context after failure',
    () => {
      const result = run(geminiPayload(root), '53');
      expect(result.status).toBe(53);
      expect(readdirSync(join(root, 'home/.gemini'))).toEqual([]);
    },
  );
});
