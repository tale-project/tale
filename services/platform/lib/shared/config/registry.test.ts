import { describe, expect, it } from 'vitest';

import {
  ssoConnectionFileSchema,
  SSO_CONNECTION_KEY,
} from '../schemas/enterprise_sso';
import { FILE_POLICY_TYPES, POLICY_SCHEMAS } from '../schemas/governance';
import {
  CONFIG_DOMAINS,
  CONFIG_DOMAINS_BY_NAME,
  getConfigDomain,
  getV8SyncSpec,
  V8_SYNC_DOMAINS,
} from './registry';

describe('config-domain registry', () => {
  it('has unique domain names', () => {
    const names = CONFIG_DOMAINS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('CONFIG_DOMAINS_BY_NAME mirrors CONFIG_DOMAINS', () => {
    expect(CONFIG_DOMAINS_BY_NAME.size).toBe(CONFIG_DOMAINS.length);
    for (const d of CONFIG_DOMAINS) {
      expect(CONFIG_DOMAINS_BY_NAME.get(d.name)).toBe(d);
    }
  });

  it('a v8Sync spec is present iff readContext is v8-sync', () => {
    for (const d of CONFIG_DOMAINS) {
      expect(d.v8Sync !== undefined).toBe(d.readContext === 'v8-sync');
    }
  });

  it('governance and sso are the v8-sync domains', () => {
    expect(V8_SYNC_DOMAINS.map((d) => d.name)).toEqual(['governance', 'sso']);
  });

  it('sso v8Sync resolves the connection schema + file base', () => {
    const spec = getV8SyncSpec('sso');
    expect([...spec.keys]).toEqual([SSO_CONNECTION_KEY]);
    expect(spec.schemaFor(SSO_CONNECTION_KEY)).toBe(ssoConnectionFileSchema);
    expect(spec.fileBaseFor(SSO_CONNECTION_KEY)).toBe('connection');
  });

  it('sso is not catalog-scaffolded (no scaffoldKind)', () => {
    expect(getConfigDomain('sso').scaffoldKind).toBeUndefined();
  });

  it('governance v8Sync keys exactly match FILE_POLICY_TYPES (no drift)', () => {
    const spec = getV8SyncSpec('governance');
    expect([...spec.keys].sort()).toEqual([...FILE_POLICY_TYPES].sort());
  });

  it('governance schemaFor returns the POLICY_SCHEMAS entry for every key', () => {
    const spec = getV8SyncSpec('governance');
    for (const key of FILE_POLICY_TYPES) {
      expect(spec.schemaFor(key)).toBe(POLICY_SCHEMAS[key]);
    }
  });

  it('governance fileBaseFor maps snake_case → kebab-case', () => {
    const spec = getV8SyncSpec('governance');
    expect(spec.fileBaseFor('session_idle_timeout')).toBe(
      'session-idle-timeout',
    );
    expect(spec.fileBaseFor('password_policy')).toBe('password-policy');
  });

  it('schemaFor / fileBaseFor reject unknown keys', () => {
    const spec = getV8SyncSpec('governance');
    expect(() => spec.schemaFor('not_a_policy')).toThrow();
    expect(() => spec.fileBaseFor('not_a_policy')).toThrow();
  });

  it('getConfigDomain throws for an unknown domain', () => {
    expect(() => getConfigDomain('nope')).toThrow();
  });

  it('getV8SyncSpec throws for a non-v8-sync domain', () => {
    expect(() => getV8SyncSpec('agents')).toThrow();
  });

  describe('watcher specs', () => {
    it('action-read domains declare a watcher; reactive/DB domains do not', () => {
      const withWatcher = CONFIG_DOMAINS.filter((d) => d.watcher).map(
        (d) => d.name,
      );
      expect(withWatcher.sort()).toEqual(
        [
          'agents',
          'branding',
          'integrations',
          'providers',
          'skills',
          'token-sources',
        ].sort(),
      );
      // governance is reactive (configCache via Convex queries); prompts is
      // DB-authoritative — neither needs an SSE invalidation event.
      expect(getConfigDomain('governance').watcher).toBeUndefined();
      expect(getConfigDomain('prompts').watcher).toBeUndefined();
    });

    it('derives slugs the way the watcher expects', () => {
      const agents = getConfigDomain('agents').watcher;
      expect(agents?.emitsFor('my-agent.json')).toBe(true);
      expect(agents?.emitsFor('notes.txt')).toBe(false);
      expect(agents?.slugFromRest(['my-agent.json'])).toBe('my-agent');

      const skills = getConfigDomain('skills').watcher;
      expect(skills?.emitsFor('code-reviewer/scripts/x.py')).toBe(true);
      expect(skills?.slugFromRest(['code-reviewer', 'scripts', 'x.py'])).toBe(
        'code-reviewer',
      );

      const branding = getConfigDomain('branding').watcher;
      expect(branding?.slugFromRest(['branding.json'])).toBeUndefined();
    });
  });
});
