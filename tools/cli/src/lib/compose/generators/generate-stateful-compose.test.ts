import { describe, expect, test } from 'bun:test';

import { parse } from 'yaml';

import type { RunOrigin } from '../../config/dev-origin';
import { setProjectId } from '../../project/project-context';
import { potProviderAsked } from '../services/create-bgutil-provider-service';
import type { ComposeService, ServiceConfig } from '../types';
import { generateStatefulCompose } from './generate-stateful-compose';

// getProjectId() (used for the external volume/network names) throws unless
// seeded.
setProjectId('tale');

const config = {
  version: '0.2.17',
  registry: 'ghcr.io/tale-project',
} satisfies ServiceConfig;

function servicesOf(origin?: RunOrigin): Record<string, ComposeService> {
  return (
    parse(generateStatefulCompose(config, 'demo.tale.dev', origin)) as {
      services: Record<string, ComposeService>;
    }
  ).services;
}

describe('generateStatefulCompose ↔ the database profile', () => {
  // Compose fills the variable from the workspace's .env; unset there, the
  // database starts sized for the small host this deployment must fit.
  test('the database is asked for the small profile, as a default that .env replaces', () => {
    expect(servicesOf().db?.environment).toEqual({
      DB_PROFILE: '${DB_PROFILE:-small}',
    });
    expect(servicesOf().db?.env_file).toEqual(['.env']);
  });
});

// The model relay in the backend replaced the sandbox LLM gateway
// (tale-project/tale#4942): a deployment never creates the gateway again, nor
// its volume, which one that ran it keeps until its operator removes it.
describe('generateStatefulCompose ↔ the retired model gateway', () => {
  test('declares no gateway service and no gateway volume', () => {
    const document = parse(
      generateStatefulCompose(config, 'demo.tale.dev'),
    ) as {
      services: Record<string, unknown>;
      volumes: Record<string, unknown>;
    };
    expect(Object.keys(document.services)).not.toContain('sandbox-llm-gateway');
    expect(Object.keys(document.volumes)).not.toContain('llm-gateway-data');
  });
});

describe('generateStatefulCompose ↔ the PO-token provider', () => {
  /** Run `body` with the variable set (or unset), then put it back. */
  const asked = <T>(value: string | undefined, body: () => T): T => {
    const before = process.env.VIDEO_INGEST_POT_PROVIDER;
    if (value === undefined) delete process.env.VIDEO_INGEST_POT_PROVIDER;
    else process.env.VIDEO_INGEST_POT_PROVIDER = value;
    try {
      return body();
    } finally {
      if (before === undefined) delete process.env.VIDEO_INGEST_POT_PROVIDER;
      else process.env.VIDEO_INGEST_POT_PROVIDER = before;
    }
  };

  // One more container, about 60 MiB at rest, that only YouTube links from
  // an address YouTube challenges have a use for.
  test.each([undefined, '', 'false', ' False '])(
    'leaves the provider out unless the deployment asked for it (%p)',
    (value) => {
      const services = asked(value, () => servicesOf());
      expect(Object.keys(services)).not.toContain('bgutil-provider');
      // Everything else is there as before.
      expect(Object.keys(services).toSorted()).toEqual([
        'db',
        'docker-api',
        'object-store',
        'proxy',
        'sandbox',
        'sandbox-egress',
      ]);
    },
  );

  test.each(['true', ' TRUE '])(
    'declares the provider where the deployment says true (%p)',
    (value) => {
      const services = asked(value, () => servicesOf());
      expect(services['bgutil-provider']?.image).toBe(
        'brainicism/bgutil-ytdlp-pot-provider:1.3.1',
      );
      expect(services['bgutil-provider']?.networks).toEqual(['internal']);
    },
  );

  // `yes` would read as off here and in the backend, and a walled video
  // would be the first to say so.
  test.each(['yes', '1', 'on', 'enabled'])(
    'refuses a word that is neither true nor false (%p)',
    (value) => {
      expect(() => asked(value, () => servicesOf())).toThrow(
        `VIDEO_INGEST_POT_PROVIDER must be true, false, or unset; got: ${JSON.stringify(value)}`,
      );
    },
  );

  test('reads the deployment’s word, off where it says nothing', () => {
    expect(potProviderAsked(() => undefined)).toBe(false);
    expect(potProviderAsked(() => 'false')).toBe(false);
    expect(potProviderAsked(() => 'true')).toBe(true);
    expect(
      potProviderAsked((name) =>
        name === 'VIDEO_INGEST_POT_PROVIDER' ? 'true' : undefined,
      ),
    ).toBe(true);
  });
});

describe('generateStatefulCompose ↔ tale deploy --host', () => {
  test('the proxy answers on the host of the run instead of .env', () => {
    const services = servicesOf({
      host: 'tale.example.com',
      siteUrl: 'https://tale.example.com',
    });
    expect(services.proxy?.environment).toMatchObject({
      HOST: 'tale.example.com',
      SITE_URL: 'https://tale.example.com',
    });
    // Only the proxy serves the host; the rest of the tier keeps .env's.
    for (const [name, service] of Object.entries(services)) {
      if (name === 'proxy') continue;
      expect(service.environment?.HOST, name).toBeUndefined();
      expect(service.environment?.SITE_URL, name).toBeUndefined();
    }
  });

  test('without --host the proxy reads HOST and SITE_URL from .env', () => {
    const proxy = servicesOf().proxy;
    expect(proxy?.env_file).toEqual(['.env']);
    // Only the Compose projects it routes (the stateful one and both
    // colours) and Traefik's heap limit (memory-env.ts).
    expect(proxy?.environment).toEqual({
      TALE_PROXY_PROJECTS: 'tale tale-blue tale-green',
      GOMEMLIMIT: '28MiB',
    });
  });
});
