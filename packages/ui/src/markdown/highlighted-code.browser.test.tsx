import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { render, waitFor } from '@/tests/utils/render';

import { HighlightedCode } from './highlighted-code';

import '../globals.css';

afterEach(() => {
  cleanup();
});

// Read-only code sits on the one code line height (`leading-code`, 1.5): the
// block's 14px type takes a 21px row, plain or highlighted.
const ROW_PX = 21;

const SOURCE = [
  'export function greet(name: string): string {',
  '  // Say hello.',
  '  return `Hello, ${name}`;',
  '}',
  '',
  'greet("Tale");',
].join('\n');

describe('HighlightedCode', () => {
  it('keeps one 21px row per line from the plain text to the highlight, numbers on their lines', async () => {
    const { container } = render(
      <HighlightedCode code={SOURCE} language="ts" />,
    );
    const block = container.firstElementChild as HTMLElement;
    // Plain text until the highlight lands, on the same rows.
    const plain = block.querySelector('pre');
    expect(plain).not.toBeNull();
    expect(block.querySelector('.line')).toBeNull();
    expect(getComputedStyle(plain as HTMLElement).lineHeight).toBe(
      `${ROW_PX}px`,
    );
    const plainHeight = block.getBoundingClientRect().height;

    await waitFor(
      () => expect(block.querySelectorAll('.line')).toHaveLength(6),
      { timeout: 10_000 },
    );
    const lines = [...block.querySelectorAll<HTMLElement>('.line')];
    expect(block.querySelector('.code-block-numbered')).not.toBeNull();
    for (const line of lines) {
      expect(getComputedStyle(line).fontSize).toBe('14px');
      expect(getComputedStyle(line).lineHeight).toBe(`${ROW_PX}px`);
      // The number shares its row's line height: it sits on its line.
      expect(getComputedStyle(line, '::before').content).toBe('counter(line)');
      expect(getComputedStyle(line, '::before').lineHeight).toBe(`${ROW_PX}px`);
    }
    const tops = lines.map((line) => line.getBoundingClientRect().top);
    for (let index = 1; index < tops.length; index++)
      expect(tops[index] - tops[index - 1]).toBe(ROW_PX);
    // The highlight lands without moving what follows the block.
    expect(block.getBoundingClientRect().height).toBe(plainHeight);
  });
});
