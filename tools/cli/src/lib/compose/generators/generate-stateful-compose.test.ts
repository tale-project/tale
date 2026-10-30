import { describe, expect, test } from 'bun:test';

import { parse } from 'yaml';

import type { RunOrigin } from '../../config/dev-origin';
import { setProjectId } from '../../project/project-context';
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
    expect(proxy?.environment).toBeUndefined();
  });
});
