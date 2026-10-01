import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentionTriggerChips } from './mention-trigger-chips';

const { useActorDirectory, requestedSlugs, preview } = vi.hoisted(() => ({
  useActorDirectory: vi.fn(),
  requestedSlugs: [] as string[][],
  preview: {
    willTrigger: true,
    reason: 'ok' as 'ok' | 'standard_agent_unavailable',
  },
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: { slug?: string }) =>
      params?.slug ? `${key}:${params.slug}` : key,
  }),
}));

vi.mock('../hooks/use-actor-directory', () => ({ useActorDirectory }));

vi.mock('../hooks/queries', () => ({
  useMentionTriggerPreview: (_target: unknown, slugs: string[]) => {
    if (slugs.length > 0) requestedSlugs.push(slugs);
    return {
      previews: slugs.map((slug) => ({ slug, ...preview })),
    };
  },
}));

const REVIEWER = { id: 'agent-7f3a', name: 'PR Reviewer' };

beforeEach(() => {
  requestedSlugs.length = 0;
  preview.willTrigger = true;
  preview.reason = 'ok';
  useActorDirectory.mockReset();
  useActorDirectory.mockReturnValue({ agents: [REVIEWER] });
});

function renderChips(draft: string, baseline?: string) {
  render(
    <MentionTriggerChips
      organizationId="org-1"
      projectId="project-1"
      target={{ taskId: 'task-1' }}
      draft={draft}
      {...(baseline !== undefined ? { baseline } : {})}
    />,
  );
}

describe('MentionTriggerChips', () => {
  it("lists the project's agents, not the organization's empty roster", () => {
    renderChips('');
    expect(useActorDirectory).toHaveBeenCalledWith('org-1', 'project-1');
  });

  it('previews an agent named by the handle the picker inserts', async () => {
    renderChips('@pr.reviewer please look');

    expect(
      await screen.findByText(
        'mentionPreview.willRespond:PR Reviewer',
        {},
        { timeout: 2000 },
      ),
    ).toBeInTheDocument();
    expect(requestedSlugs.at(-1)).toEqual(['agent-7f3a']);
  });

  it('shows one chip for an agent named twice, by name and by id', async () => {
    renderChips('@prreviewer and @agent-7f3a');

    expect(
      await screen.findAllByText(
        'mentionPreview.willRespond:PR Reviewer',
        {},
        { timeout: 2000 },
      ),
    ).toHaveLength(1);
  });

  it('shows no chip for a person or a typo', async () => {
    renderChips('@ada and @nobody-here');

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(requestedSlugs).toEqual([]);
  });

  it('shows no chip for an agent the saved text already names', async () => {
    renderChips('@pr.reviewer still owns this', '@pr.reviewer owns this');

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(requestedSlugs).toEqual([]);
  });

  it('says the standard agent will not answer someone it cannot start for', async () => {
    preview.willTrigger = false;
    preview.reason = 'standard_agent_unavailable';
    renderChips('@pr.reviewer please look');

    expect(
      await screen.findByText(
        'mentionPreview.standardAgentUnavailable:PR Reviewer',
        {},
        { timeout: 2000 },
      ),
    ).toBeInTheDocument();
  });
});
