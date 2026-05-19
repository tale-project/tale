import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { isPrivateIp } from '../lib/http/safe_fetch';
import { checkProviderHostPolicy } from './file_actions';

describe('isPrivateIp', () => {
  it.each([
    'localhost',
    'foo.local',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.0.1',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.169.254',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
  ])('rejects %s as private', (host) => {
    expect(isPrivateIp(host)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    'api.openai.com',
    'openrouter.ai',
    '2606:4700:4700::1111',
  ])('accepts %s as public', (host) => {
    expect(isPrivateIp(host)).toBe(false);
  });
});

describe('checkProviderHostPolicy', () => {
  function blocks(url: string, code: string) {
    let thrown: unknown;
    try {
      checkProviderHostPolicy(url);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ConvexError);
    if (thrown instanceof ConvexError) {
      const data = thrown.data as { code?: string };
      expect(data.code).toBe(code);
    }
  }

  it('rejects malformed URLs', () => {
    blocks('not-a-url', 'INVALID_URL');
  });

  it.each([
    'http://169.254.169.254/',
    'http://metadata.google.internal/',
    'http://metadata/',
    'http://100.100.100.200/', // Alibaba
    'http://192.0.0.192/', // Oracle
    'http://metadata.tencentyun.com/',
  ])('blocks IMDS host %s', (url) => {
    blocks(url, 'BLOCKED_HOST');
  });

  it.each([
    'http://169.254.169.254./',
    'http://metadata.google.internal./',
    'http://METADATA./',
  ])('blocks IMDS variant with trailing dot / case %s', (url) => {
    blocks(url, 'BLOCKED_HOST');
  });

  it.each([
    'http://[fd00:ec2::254]/', // AWS IMDS IPv6
  ])('blocks IPv6 IMDS host %s', (url) => {
    blocks(url, 'BLOCKED_HOST');
  });

  it.each([
    'http://10.0.0.5:11434/',
    'http://192.168.1.1/',
    'http://localhost:11434/',
    'http://[::1]:8080/',
    'http://[::ffff:7f00:1]/', // IPv4-mapped 127.0.0.1
  ])('blocks RFC1918 / loopback %s when env not set', (url) => {
    delete process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS;
    blocks(url, 'PRIVATE_HOST_BLOCKED');
  });

  it.each(['https://api.openai.com/v1', 'https://openrouter.ai/api/v1'])(
    'accepts public host %s',
    (url) => {
      expect(() => checkProviderHostPolicy(url)).not.toThrow();
    },
  );

  it('accepts loopback when TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1', () => {
    process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS = '1';
    try {
      expect(() =>
        checkProviderHostPolicy('http://localhost:11434/'),
      ).not.toThrow();
    } finally {
      delete process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS;
    }
  });
});
