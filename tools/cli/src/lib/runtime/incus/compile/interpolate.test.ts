import { describe, expect, test } from 'bun:test';

import {
  interpolate,
  interpolateDeep,
  interpolationSource,
  parseDotenv,
  referencedNames,
} from './interpolate';
import { RefusalError } from './refusals';

const from =
  (values: Record<string, string>) =>
  (name: string): string | undefined =>
    Object.hasOwn(values, name) ? values[name] : undefined;

function refused(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    if (error instanceof RefusalError) return error.refusal.id;
    throw error;
  }
  return null;
}

describe('compose interpolation', () => {
  const lookup = from({ SET: 'value', EMPTY: '' });

  test('the operators, as Docker Compose reads them', () => {
    expect(interpolate('${SET}', lookup)).toBe('value');
    expect(interpolate('$SET/x', lookup)).toBe('value/x');
    expect(interpolate('${UNSET}', lookup)).toBe('');
    expect(interpolate('${UNSET:-d}', lookup)).toBe('d');
    expect(interpolate('${EMPTY:-d}', lookup)).toBe('d');
    expect(interpolate('${EMPTY-d}', lookup)).toBe('');
    expect(interpolate('${UNSET-d}', lookup)).toBe('d');
    expect(interpolate('${SET:?needed}', lookup)).toBe('value');
    expect(interpolate('${EMPTY?needed}', lookup)).toBe('');
  });

  test('nested defaults, escapes and literal dollars', () => {
    expect(interpolate('${UNSET:-${SET}}', lookup)).toBe('value');
    expect(interpolate('${UNSET:-a${UNSET2:-${SET}}b}', lookup)).toBe(
      'avalueb',
    );
    expect(interpolate('$$SET', lookup)).toBe('$SET');
    expect(interpolate('cost: 5$', lookup)).toBe('cost: 5$');
    expect(interpolate('$1 and $-', lookup)).toBe('$1 and $-');
  });

  test('a required variable that is missing is refused with its message', () => {
    expect(refused(() => interpolate('${UNSET:?it is needed}', lookup))).toBe(
      'variable-required',
    );
    expect(refused(() => interpolate('${EMPTY:?it is needed}', lookup))).toBe(
      'variable-required',
    );
    expect(refused(() => interpolate('${UNSET?it is needed}', lookup))).toBe(
      'variable-required',
    );
    try {
      interpolate('${UNSET:?${SET} is needed}', lookup);
    } catch (error) {
      expect((error as RefusalError).refusal.detail).toContain(
        'value is needed',
      );
    }
  });

  test('every other operator and malformed reference is refused', () => {
    for (const text of ['${SET:+x}', '${SET+x}', '${SET/a/b}', '${SET#x}'])
      expect(
        refused(() => interpolate(text, lookup)),
        text,
      ).toBe('interpolation-operator');
    for (const text of ['${SET', '${}', '${1X}'])
      expect(
        refused(() => interpolate(text, lookup)),
        text,
      ).toBe('interpolation-syntax');
  });

  test('values of every depth are interpolated, keys never', () => {
    expect(
      interpolateDeep(
        { '${SET}': ['${SET}', { inner: '${UNSET:-d}' }, 3, true] },
        lookup,
      ),
    ).toEqual({ '${SET}': ['value', { inner: 'd' }, 3, true] });
  });

  test('referenced names include those inside defaults and errors', () => {
    expect([...referencedNames('${A:-${B}} $C ${D:?${E}} $$F')].sort()).toEqual(
      ['A', 'B', 'C', 'D', 'E'],
    );
  });
});

describe('the .env grammar of Docker Compose', () => {
  test('plain, exported, YAML-style and commented lines', () => {
    expect(
      parseDotenv(
        [
          '# a comment',
          'PLAIN=value',
          'export EXPORTED=yes',
          'SPACED = around ',
          'YAML: style',
          'COMMENTED=kept # dropped',
          'HASH=kept#too',
          'EMPTY=',
          '',
        ].join('\n'),
      ),
    ).toEqual({
      PLAIN: 'value',
      EXPORTED: 'yes',
      SPACED: 'around',
      YAML: 'style',
      COMMENTED: 'kept',
      HASH: 'kept#too',
      EMPTY: '',
    });
  });

  test('single quotes are literal, double quotes expand escapes and variables', () => {
    expect(
      parseDotenv(
        [
          "SINGLE='a $HOME \\n b'",
          'DOUBLE="a\\nb \\"q\\" ${BASE}"',
          'ESCAPED="cost \\$5"',
          'MULTI="one',
          'two"',
          'BASE=base',
        ].join('\n'),
        from({ BASE: 'outer' }),
      ),
    ).toEqual({
      SINGLE: 'a $HOME \\n b',
      DOUBLE: 'a\nb "q" outer',
      ESCAPED: 'cost $5',
      MULTI: 'one\ntwo',
      BASE: 'base',
    });
  });

  test('an earlier key is referenced, and the environment wins over it', () => {
    expect(
      parseDotenv('A=file\nB=${A}-x\nC=${D:-default}\n', from({})),
    ).toEqual({ A: 'file', B: 'file-x', C: 'default' });
    expect(parseDotenv('A=file\nB=${A}-x\n', from({ A: 'env' }))).toEqual({
      A: 'file',
      B: 'env-x',
    });
  });

  test('a bare key takes the value of the environment, or nothing', () => {
    expect(
      parseDotenv('FROM_ENV\nMISSING\n', from({ FROM_ENV: 'env' })),
    ).toEqual({
      FROM_ENV: 'env',
    });
  });

  test('a malformed line is refused', () => {
    for (const text of ['A B=1\n', 'A$=1\n', 'A="never closed\n'])
      expect(
        refused(() => parseDotenv(text)),
        text,
      ).toBe('dotenv-syntax');
  });

  test('a refused line names its number, never its text, which may be a secret', () => {
    for (const text of [
      'DB_PASSWORD s3cr3t-value\n',
      'DB_PASSWORD=s3cr3t-${value\n',
      'DB_PASSWORD="s3cr3t-${value:+x}"\n',
      'DB_PASSWORD s3cr3t-value',
    ]) {
      const error = (() => {
        try {
          parseDotenv(text);
        } catch (thrown) {
          return thrown as Error;
        }
        return null;
      })();
      expect(error?.message, text).toContain('.env line 1');
      expect(error?.message, text).not.toContain('s3cr3t');
    }
  });
});

describe('where the variables come from, per path (R-11)', () => {
  const documents = [{ services: { a: { image: '${IMAGE_TAG} ${HOST}' } } }];
  const dotenv = 'HOST=file.example\nIMAGE_TAG=1\nUNUSED=x\n';

  test('workspace: the process wins over .env, and a shadow is reported', () => {
    const source = interpolationSource('workspace', {
      dotenv,
      processEnvironment: { HOST: 'shell.example', PATH: '/bin', OTHER: 'y' },
      documents,
    });
    expect(source.variables).toEqual({
      HOST: 'shell.example',
      IMAGE_TAG: '1',
      UNUSED: 'x',
    });
    expect(source.shadowed).toEqual(['HOST']);
  });

  test('managed: .env alone, the process ignored', () => {
    const source = interpolationSource('managed', {
      dotenv,
      processEnvironment: { HOST: 'shell.example' },
      documents,
    });
    expect(source.variables).toEqual({
      HOST: 'file.example',
      IMAGE_TAG: '1',
      UNUSED: 'x',
    });
    expect(source.shadowed).toEqual([]);
  });

  test('workspace: a process variable the documents reference is kept without .env', () => {
    const source = interpolationSource('workspace', {
      dotenv: '',
      processEnvironment: { IMAGE_TAG: '2' },
      documents,
    });
    expect(source.variables).toEqual({ IMAGE_TAG: '2' });
  });
});
