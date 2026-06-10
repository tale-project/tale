import { describe, expect, it } from 'vitest';

import {
  containsPlaceholder,
  extractPlaceholders,
  substituteTemplate,
} from './substitute';

describe('containsPlaceholder', () => {
  it('detects markers', () => {
    expect(containsPlaceholder('hello {{name}}')).toBe(true);
    expect(containsPlaceholder('no markers here')).toBe(false);
  });
});

describe('extractPlaceholders', () => {
  it('returns distinct trimmed names', () => {
    expect(extractPlaceholders('{{ a }} {{b}} {{a}}')).toEqual(['a', 'b']);
  });

  it('returns empty for marker-free text', () => {
    expect(extractPlaceholders('plain')).toEqual([]);
  });
});

describe('substituteTemplate', () => {
  it('substitutes resolved names', () => {
    expect(
      substituteTemplate('hi {{name}}!', (n) =>
        n === 'name' ? 'Ada' : undefined,
      ),
    ).toBe('hi Ada!');
  });

  it('preserves unknown markers byte-for-byte (including spacing)', () => {
    expect(substituteTemplate('a {{ foo }} b', () => undefined)).toBe(
      'a {{ foo }} b',
    );
  });

  it('treats empty string as a real substitution (removes marker)', () => {
    expect(substituteTemplate('a{{x}}b', () => '')).toBe('ab');
  });

  it('trims the name passed to the resolver', () => {
    const seen: string[] = [];
    substituteTemplate('{{  spaced  }}', (n) => {
      seen.push(n);
      return 'ok';
    });
    expect(seen).toEqual(['spaced']);
  });

  it('returns input unchanged when no markers present', () => {
    expect(substituteTemplate('nothing', () => 'x')).toBe('nothing');
  });

  it('does NOT re-scan substituted values (template-injection safety)', () => {
    // A resolved value that itself looks like a marker must be inserted
    // verbatim, never re-substituted — otherwise a user-controlled value could
    // smuggle in another variable (e.g. {{secret}}).
    const resolve = (name: string): string | undefined => {
      if (name === 'userInput') return '{{secret}}';
      if (name === 'secret') return 'LEAKED';
      return undefined;
    };
    expect(substituteTemplate('Value: {{userInput}}', resolve)).toBe(
      'Value: {{secret}}',
    );
  });
});
