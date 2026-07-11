import { describe, expect, test } from 'bun:test';

import {
  RESULT_BEGIN,
  RESULT_END,
  buildConvexRunScript,
  extractSentinelResult,
  parseSentinelJson,
  stripConvexBannerLines,
} from './convex-run';

/**
 * Regression fixture for the pre-v2 transport corruption: banner-strip greps
 * with unanchored `Enter`/`Open` patterns ate JSON lines whose content matched
 * a banner prefix (this meta's title, "OpenRouter" descriptions, …). The
 * sentinel transport must return such payloads byte-intact.
 */
const ENTERPRISE_SSO_META = {
  description:
    'For each org with a legacy ssoProviders row, writes its unified ' +
    'connection.json (protocol oidc/oauth2, oidc block from issuer + scopes + ' +
    'claim/feature mappings, provisioning from roleMappingRules/defaultRole/' +
    'providerFeatures) and a connection.secrets.json with the decrypted client ' +
    'credentials, then re-syncs the configCache mirror. A per-org fs-tree ' +
    'snapshot of the sso/ directory is taken first so down can restore the ' +
    'prior files. Idempotent (re-running overwrites the same files).',
  destructive: false,
  id: '0.2.87/01_enterprise_sso_unify',
  kind: 'node',
  numericId: 1,
  reversible: true,
  semver: '0.2.87',
  slug: 'enterprise_sso_unify',
  title: 'Migrate ssoProviders into the file-based Enterprise SSO connection',
  snapshot: 'fs-tree',
};

/** Frame a payload the way the in-container script does. */
function framed(payload: string, noiseBefore = ''): string {
  return `${noiseBefore}${RESULT_BEGIN}\n${payload}\n${RESULT_END}`;
}

describe('buildConvexRunScript', () => {
  test('frames the result between the sentinels and preserves the exit code', () => {
    const script = buildConvexRunScript('migrations:runAll');
    expect(
      script.startsWith('# tale-bundle-sentinel:convex-run-script-v2\n'),
    ).toBe(true);
    expect(script).toContain(`echo "${RESULT_BEGIN}"`);
    expect(script).toContain(`echo "${RESULT_END}"`);
    expect(script).toContain('exit $STATUS');
    // Streams stay separate — the v1 transport's `2>&1` merge is gone.
    expect(script).not.toContain('2>&1');
    expect(script).not.toContain('grep');
  });

  test('serializes args as a single-quoted JSON literal', () => {
    const script = buildConvexRunScript(
      'migrations/framework/entrypoints:applyUp',
      { args: { to: '0.2.84', allowDestructive: true } },
    );
    expect(script).toContain(` '{"to":"0.2.84","allowDestructive":true}' `);
  });

  test('rejects unsafe function refs and args', () => {
    expect(() => buildConvexRunScript('fn; rm -rf /')).toThrow(/unsafe/);
    expect(() =>
      buildConvexRunScript('fn', { args: { cmd: "'; touch /pwned; '" } }),
    ).toThrow(/unsafe/);
  });
});

describe('extractSentinelResult', () => {
  test('slices the frame and ignores stdout noise before it', () => {
    const stdout = framed('{"ok":true}', 'env.sh: normalizing…\n');
    expect(extractSentinelResult(stdout)).toBe('{"ok":true}');
  });

  test('returns null when the frame is missing (script died early)', () => {
    expect(extractSentinelResult('bash: bunx: command not found')).toBeNull();
    expect(extractSentinelResult(`${RESULT_BEGIN}\nno end marker`)).toBeNull();
  });

  test('an empty frame (void function, empty capture) yields the empty string', () => {
    expect(extractSentinelResult(framed(''))).toBe('');
  });
});

describe('parseSentinelJson', () => {
  test('returns pretty-printed payloads byte-intact, including banner-lookalike content', () => {
    const payload = [ENTERPRISE_SSO_META];
    const stdout = framed(JSON.stringify(payload, null, 2));
    const parsed = parseSentinelJson<typeof payload>(stdout);
    expect(parsed).toEqual(payload);
    expect(parsed?.[0]?.title).toContain('Enterprise SSO');
    expect(parsed?.[0]?.description).toContain('Idempotent');
  });

  test('parses single-line values and survives noise before the frame', () => {
    expect(
      parseSentinelJson<{ inFlight: number }>(
        framed('{"inFlight":2}', 'Deprecation warning from env.sh\n'),
      ),
    ).toEqual({ inFlight: 2 });
  });

  test('returns null for a missing frame, an empty frame, or non-JSON content', () => {
    expect(parseSentinelJson('Admin key: derived')).toBeNull();
    expect(parseSentinelJson(framed(''))).toBeNull();
    expect(parseSentinelJson(framed('not json'))).toBeNull();
  });
});

describe('stripConvexBannerLines (display-only stderr filter)', () => {
  test('strips convex CLI banner lines', () => {
    const text = [
      'Admin key:',
      'Enter your deployment URL',
      '[migrations] applied on deploy',
    ].join('\n');
    expect(stripConvexBannerLines(text)).toBe('[migrations] applied on deploy');
  });

  test('keeps function log lines mentioning Enterprise or OpenRouter', () => {
    const line = `[migrations] pending: ${ENTERPRISE_SSO_META.title}`;
    expect(stripConvexBannerLines(line)).toBe(line);
  });
});
