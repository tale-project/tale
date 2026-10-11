// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { VersionAuthor } from './version-author';

const state = vi.hoisted(() => ({
  members: undefined as { userId: string; displayName: string }[] | undefined,
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: state.members }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

beforeEach(() => {
  state.members = [{ userId: 'user-noah', displayName: 'Noah Weber' }];
});

function renderAuthor(facts: Parameters<typeof VersionAuthor>[0]['facts']) {
  return render(<VersionAuthor organizationId="org-1" facts={facts} />);
}

describe('VersionAuthor', () => {
  it('names who saved it, with the client and the door they used', () => {
    renderAuthor({
      actor: 'api-key:user-noah',
      via: 'mcp',
      clientName: 'Claude Code',
    });
    expect(screen.getByText('Noah Weber')).toBeVisible();
    expect(screen.getByText('with Claude Code through MCP')).toBeVisible();
  });

  it('says only the door when no client is known, or the door was inferred', () => {
    const { unmount } = renderAuthor({
      actor: 'user-me',
      via: 'app',
      clientName: null,
    });
    expect(screen.getByText('You')).toBeVisible();
    expect(screen.getByText('in the app')).toBeVisible();
    unmount();
    renderAuthor({
      actor: 'api-key:user-noah',
      via: 'mcp',
      viaInferred: true,
      clientName: 'Claude Code',
    });
    expect(screen.getByText('through MCP')).toBeVisible();
    expect(screen.queryByText(/Claude Code/)).toBeNull();
  });

  it('names the platform as Tale without a caption', () => {
    renderAuthor({
      actor: 'system:provisioning',
      via: 'system',
      clientName: null,
    });
    expect(screen.getByText('Tale')).toBeVisible();
    expect(screen.queryByText('by Tale')).toBeNull();
  });

  it('holds a placeholder while the directory loads, then says former member', () => {
    state.members = undefined;
    const { container, unmount } = renderAuthor({
      actor: 'user-gone',
      via: 'upload',
      clientName: null,
    });
    expect(
      container.querySelector('[data-slot="author-pending"]'),
    ).not.toBeNull();
    expect(screen.queryByText('A former member')).toBeNull();
    unmount();
    state.members = [];
    renderAuthor({ actor: 'user-gone', via: 'upload', clientName: null });
    expect(screen.getByText('A former member')).toBeVisible();
    expect(screen.getByText('from an uploaded package')).toBeVisible();
  });

  it('says an actor that names nobody is not recorded', () => {
    renderAuthor({ actor: '', via: null, clientName: null });
    expect(screen.getByText('Not recorded')).toBeVisible();
  });
});
