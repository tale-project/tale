import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

import type { ShownStatus } from '../lib/status';
import { SessionStatus } from './session-status';

const WORDS: [ShownStatus, string][] = [
  ['stopped', 'Stopped'],
  ['assigning', 'Assigning proxy'],
  ['starting', 'Starting'],
  ['running', 'Running'],
  ['stopping', 'Stopping'],
  ['error', 'Error'],
];

describe('SessionStatus', () => {
  it.each(WORDS)('says %s in words', (status, words) => {
    renderApp(<SessionStatus status={status} />);
    expect(screen.getByText(words)).toBeVisible();
  });

  it('adds nothing to the name of what it sits in when only the dot shows: the neighbour says the state', () => {
    renderApp(
      <a href="/sessions/1">
        <SessionStatus status="running" dotOnly />
        0001 Running
      </a>,
    );
    expect(screen.getByRole('link', { name: '0001 Running' })).toBeVisible();
  });

  it('has no accessibility violations', async () => {
    const view = renderApp(<SessionStatus status="error" />);
    await checkAccessibility(view);
  });
});
