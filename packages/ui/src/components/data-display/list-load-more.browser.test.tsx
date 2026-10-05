import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { ListLoadMore } from './list-load-more';

import '../../globals.css';

afterEach(cleanup);

function PagedRows({ onOpen }: { onOpen: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(20);
  return (
    <div ref={root} style={{ height: 300, overflowY: 'auto' }}>
      <ol>
        {Array.from({ length: count }, (_, index) => index + 1).map((row) => (
          <li key={row}>
            <button
              type="button"
              style={{ height: 32, width: '100%' }}
              onClick={onOpen}
            >
              Row {row}
            </button>
          </li>
        ))}
      </ol>
      <ListLoadMore
        hasMore={count < 200}
        onLoadMore={() => setCount((previous) => previous + 20)}
        root={root}
      />
    </div>
  );
}

describe('ListLoadMore pointer and focus (real layout)', () => {
  it.each([400, 1280])(
    'keeps the paging control under the pointer at width %i',
    async (width) => {
      await page.viewport(width, 800);
      const onOpen = vi.fn();
      render(<PagedRows onOpen={onOpen} />);
      const more = page.getByRole('button', { name: 'Load more' });
      await more.click();
      await expect
        .poll(() => screen.getAllByRole('button', { name: /^Row / }).length)
        .toBe(40);
      expect(screen.getByRole('button', { name: 'Load more' })).toHaveFocus();
      await more.click();
      await expect
        .poll(() => screen.getAllByRole('button', { name: /^Row / }).length)
        .toBe(60);
      expect(onOpen).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Load more' })).toHaveFocus();
    },
  );
});
