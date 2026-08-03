// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MentionText } from './mention-text';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    members: [{ id: 'u1', name: 'Ada', email: 'ada@example.com' }],
    agents: [{ id: 'rs774n7chzm7tbf9p5fhsq2xr58br0nb', name: 'PR Reviewer' }],
  }),
}));

// Markdown renderer pulls chat chrome (images, citations) — stub the shared
// component map to keep this suite focused on MD + mention composition.
vi.mock('@/app/features/shared/markdown/markdown-renderer', () => ({
  markdownWrapperStyles: '',
  markdownComponents: {},
}));

describe('MentionText — markdown', () => {
  it('renders markdown headings and emphasis', () => {
    render(
      <MentionText
        body={'# Summary\n\n**Status:** ready'}
        organizationId="org_1"
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Summary' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Status:', { selector: 'strong' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('# Summary')).not.toBeInTheDocument();
  });

  it('still mentionizes @handles inside paragraphs', () => {
    render(<MentionText body="Ping @ada please" organizationId="org_1" />);

    expect(screen.getByText('@Ada')).toBeInTheDocument();
    expect(screen.queryByText('@ada')).not.toBeInTheDocument();
  });

  it('resolves an agent by name handle AND by raw instance id', () => {
    render(
      <MentionText
        body="@pr.reviewer take over from @rs774n7chzm7tbf9p5fhsq2xr58br0nb"
        organizationId="org_1"
      />,
    );

    expect(screen.getAllByText('@PR Reviewer')).toHaveLength(2);
    expect(screen.queryByText(/@pr\.reviewer/)).not.toBeInTheDocument();
  });
});
