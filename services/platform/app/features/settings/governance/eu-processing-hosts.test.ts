import { EU_PROCESSING_HOSTS_MAX } from '@tale/shared/schemas/governance';
import { describe, expect, it } from 'vitest';

import { hostListProblem, parseHostLines } from './eu-processing-hosts';

describe('parseHostLines', () => {
  it('trims, lowercases and drops blank lines and repeats', () => {
    expect(
      parseHostLines(
        '  LLM.Example.EU \r\n\n my-resource.openai.azure.com\nllm.example.eu\n',
      ),
    ).toEqual(['llm.example.eu', 'my-resource.openai.azure.com']);
  });

  it('reads an empty field as no hosts', () => {
    expect(parseHostLines(' \n ')).toEqual([]);
  });
});

describe('hostListProblem', () => {
  it('passes hosts of the organization’s own and a vendor’s EU endpoint [GOV-R17]', () => {
    expect(
      hostListProblem([
        'llm.example.eu',
        'my-resource.openai.azure.com',
        '10.0.0.7',
        '[fd00::7]',
        'eu.openrouter.ai',
      ]),
    ).toBeUndefined();
  });

  it.each([
    'https://llm.example.eu',
    'llm.example.eu:8443',
    'llm.example.eu/v1',
    '*.example.eu',
    '127.1',
  ])('names %s as no host [GOV-R17]', (host) => {
    expect(hostListProblem(['llm.example.eu', host])).toEqual({
      kind: 'invalid',
      host,
    });
  });

  it.each([
    ['openrouter.ai', 'eu.openrouter.ai'],
    ['us.api.openai.com', 'eu.api.openai.com'],
    ['api.mistral.ai', 'api.eu.mistral.ai'],
  ])(
    'names the EU endpoint the rule counts instead of %s [GOV-R17]',
    (host, euHost) => {
      expect(hostListProblem([host])).toEqual({ kind: 'vendor', host, euHost });
    },
  );

  it('refuses more hosts than a policy keeps', () => {
    const hosts = Array.from(
      { length: EU_PROCESSING_HOSTS_MAX + 1 },
      (_, index) => `llm-${index}.example.eu`,
    );
    expect(hostListProblem(hosts)).toEqual({
      kind: 'tooMany',
      max: EU_PROCESSING_HOSTS_MAX,
    });
    expect(hostListProblem(hosts.slice(1))).toBeUndefined();
  });
});
