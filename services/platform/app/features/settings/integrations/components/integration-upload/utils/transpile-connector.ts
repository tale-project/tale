import { transform } from 'sucrase';

/**
 * Transpile TypeScript connector code to JavaScript by stripping type annotations.
 * Uses sucrase for fast, lightweight type-only transpilation.
 */
export function transpileConnectorCode(tsCode: string): string {
  const result = transform(tsCode, {
    transforms: ['typescript'],
    disableESTransforms: true,
  });
  return result.code;
}
