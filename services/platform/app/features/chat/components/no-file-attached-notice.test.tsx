// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import {
  NoFileAttachedNotice,
  fileNotAttached,
} from './no-file-attached-notice';

describe('fileNotAttached [CHAT-R35]', () => {
  it('reads the stamp structurally and defaults to false', () => {
    expect(fileNotAttached({ fileNotAttached: true })).toBe(true);
    expect(fileNotAttached({ fileNotAttached: false })).toBe(false);
    expect(fileNotAttached({ fileNotAttached: 'yes' })).toBe(false);
    expect(fileNotAttached({ outputTokens: 12 })).toBe(false);
    expect(fileNotAttached(undefined)).toBe(false);
  });
});

describe('NoFileAttachedNotice [CHAT-R35]', () => {
  it('says no file was attached to the reply', () => {
    render(<NoFileAttachedNotice />);
    expect(
      screen.getByText('No file was attached to this reply.'),
    ).toBeInTheDocument();
  });
});
