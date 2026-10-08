import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { FlowNodeIssueMarker } from '../flow/node-issue-marker';
import {
  IssueAnnouncer,
  IssueCountButton,
  type IssueAnnouncerProps,
} from './issue-summary';

import '../../globals.css';

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

function announced(): string {
  return screen.getByRole('status').textContent ?? '';
}

describe('IssueAnnouncer', () => {
  const props = (
    overrides: Partial<IssueAnnouncerProps>,
  ): IssueAnnouncerProps => ({
    counts: { errors: 2, warnings: 1 },
    status: 'ready',
    announceKey: 'a',
    ...overrides,
  });

  it('is a polite, atomic, visually hidden status region', () => {
    render(<IssueAnnouncer {...props({})} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toHaveClass('sr-only');
  });

  it('says nothing for the result it mounts with', () => {
    render(<IssueAnnouncer {...props({})} />);
    expect(announced()).toBe('');
  });

  it('speaks once per new key, only when the check has settled', () => {
    const { rerender } = render(<IssueAnnouncer {...props({})} />);
    rerender(
      <IssueAnnouncer {...props({ announceKey: 'b', status: 'checking' })} />,
    );
    expect(announced()).toBe('');
    rerender(
      <IssueAnnouncer
        {...props({ announceKey: 'b', counts: { errors: 1, warnings: 0 } })}
      />,
    );
    expect(announced()).toBe('1 error');
    const node = screen.getByRole('status').firstElementChild;
    // The same key again is not news: the region keeps its node.
    rerender(
      <IssueAnnouncer
        {...props({ announceKey: 'b', counts: { errors: 1, warnings: 0 } })}
      />,
    );
    expect(screen.getByRole('status').firstElementChild).toBe(node);
    // A failed check is not spoken here.
    rerender(
      <IssueAnnouncer {...props({ announceKey: 'c', status: 'failed' })} />,
    );
    expect(screen.getByRole('status').firstElementChild).toBe(node);
  });

  it('replaces the region content for a repeated sentence, so it is spoken again', () => {
    const counts = { errors: 0, warnings: 0 };
    const { rerender } = render(<IssueAnnouncer {...props({ counts })} />);
    rerender(<IssueAnnouncer {...props({ counts, announceKey: 'b' })} />);
    const first = screen.getByRole('status').firstElementChild;
    expect(first).toHaveTextContent('No problems');
    rerender(<IssueAnnouncer {...props({ counts, announceKey: 'c' })} />);
    const second = screen.getByRole('status').firstElementChild;
    expect(second).toHaveTextContent('No problems');
    expect(second).not.toBe(first);
  });

  it('leads with the context when one is given', () => {
    const { rerender } = render(<IssueAnnouncer {...props({})} />);
    rerender(
      <IssueAnnouncer
        {...props({ announceKey: 'b', context: 'Saving was refused' })}
      />,
    );
    expect(announced()).toBe('Saving was refused. 2 errors and 1 warning');
  });
});

describe.each(['light', 'dark'])('issue counts contrast (%s)', (theme) => {
  it.each(['bg-background', 'bg-card'])(
    'keeps the button and the node chips readable on %s',
    async (surface) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = render(
        <div className={`${surface} text-foreground flex gap-2 p-4`}>
          <IssueCountButton counts={{ errors: 2, warnings: 1 }} />
          <IssueCountButton counts={{ errors: 0, warnings: 0 }} />
          <IssueCountButton
            counts={{ errors: 2, warnings: 1 }}
            status="checking"
          />
          <IssueCountButton
            counts={{ errors: 2, warnings: 1 }}
            status="failed"
          />
          <span>
            <FlowNodeIssueMarker errors={3} warnings={12} />
          </span>
        </div>,
      );
      // Let the pops and fades finish: axe reads the colour at rest.
      await new Promise((resolve) => setTimeout(resolve, 400));
      // The chips are `aria-hidden` decoration, but their contrast still
      // matters to the eye: judge them as text.
      for (const marker of container.querySelectorAll(
        '[data-slot="flow-node-issue-marker"]',
      )) {
        marker.removeAttribute('aria-hidden');
      }
      const result = await axe.run(container, {
        runOnly: ['color-contrast', 'button-name', 'aria-allowed-attr'],
      });
      expect(result.violations).toEqual([]);
      expect(result.passes.some((rule) => rule.id === 'color-contrast')).toBe(
        true,
      );
    },
  );
});

describe('issue counts motion', () => {
  it('pops a count and fades a chip in, and holds both still under reduced motion', async () => {
    const { container, rerender } = render(
      <>
        <IssueCountButton counts={{ errors: 1, warnings: 0 }} />
        <FlowNodeIssueMarker errors={1} warnings={0} />
      </>,
    );
    const animated = () => [
      ...container.querySelectorAll<HTMLElement>('.animate-in'),
    ];
    expect(animated()).toHaveLength(2);
    for (const element of animated()) {
      expect(getComputedStyle(element).animationName).not.toBe('none');
    }
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    rerender(
      <>
        <IssueCountButton counts={{ errors: 2, warnings: 0 }} />
        <FlowNodeIssueMarker errors={2} warnings={0} />
      </>,
    );
    for (const element of animated()) {
      expect(getComputedStyle(element).animationName).toBe('none');
    }
  });
});
