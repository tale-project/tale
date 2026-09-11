import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import { resolveInferenceSpec } from './model';
import { inferenceFixture } from './tests/fixture';

test.each(
  ['en', 'de', 'fr'].flatMap((locale) =>
    ['LF', 'CRLF'].map((lineEnding) => ({ locale, lineEnding })),
  ),
)(
  'the $locale role-dedicated topology example resolves with $lineEnding through the production schema',
  async ({ locale, lineEnding }) => {
    const original = await readFile(
      resolve(
        import.meta.dir,
        '../../../../../docs',
        locale,
        'self-hosted/configuration/private-inference.md',
      ),
      'utf8',
    );
    const text = original.replace(
      /\r?\n/g,
      lineEnding === 'CRLF' ? '\r\n' : '\n',
    );
    const fragments = [
      ...text.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/gu),
    ].map((match) => JSON.parse(match[1]!) as unknown);
    const declaration = fragments.find(
      (value) =>
        z.object({ nodes: z.array(z.unknown()) }).safeParse(value).success,
    );
    expect(declaration).toBeDefined();
    const raw = inferenceFixture();
    const spec = resolveInferenceSpec(
      {
        ...raw,
        models: ['reasoning', 'vision', 'embedding'].map((role) =>
          Object.assign({}, raw.models[0], {
            key: role,
            apiModel: role,
            modelType: role === 'vision' ? 'qwen3_vl' : 'qwen3',
            requiredKernels: [],
            capability: role === 'reasoning' ? 'text' : role,
            ...(role === 'embedding' ? { embeddingDimensions: 1536 } : {}),
          }),
        ),
        ...z.object({ nodes: z.array(z.unknown()) }).parse(declaration),
      },
      {
        TALE_REASONING_ADDRESS: '10.70.0.10',
        TALE_VISION_ADDRESS: '10.70.0.11',
        TALE_EMBEDDING_ADDRESS: '10.70.0.12',
      },
    );
    expect(spec.nodes.map((node) => node.models)).toEqual([
      ['reasoning'],
      ['vision'],
      ['embedding'],
    ]);
    expect(spec.nodes.map((node) => node.address)).toEqual([
      '10.70.0.10',
      '10.70.0.11',
      '10.70.0.12',
    ]);
  },
);
