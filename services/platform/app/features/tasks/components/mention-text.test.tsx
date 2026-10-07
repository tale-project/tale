// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskActorDirectoryProvider } from '../hooks/task-actor-directory-context';
import { MentionText } from './mention-text';

const performance = vi.hoisted(() => ({
  directoryRead: vi.fn(),
  markdownRender: vi.fn(),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => {
    performance.directoryRead();
    return {
      members: [{ id: 'u1', name: 'Ada', email: 'ada@example.com' }],
      agents: [{ id: 'rs774n7chzm7tbf9p5fhsq2xr58br0nb', name: 'PR Reviewer' }],
      automations: [{ slug: 'vat-return-desk', name: 'Swiss VAT return desk' }],
    };
  },
}));

vi.mock('react-markdown', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-markdown')>();
  return {
    ...original,
    default: (props: Parameters<typeof original.default>[0]) => {
      performance.markdownRender();
      return <original.default {...props} />;
    },
  };
});

beforeEach(() => {
  performance.directoryRead.mockClear();
  performance.markdownRender.mockClear();
});

// Markdown renderer pulls chat chrome (images, citations) — stub the shared
// component map to keep this suite focused on MD + mention composition.
vi.mock('@/app/features/shared/markdown/markdown-renderer', () => ({
  markdownWrapperStyles: '',
  markdownComponents: {},
}));

describe('MentionText — markdown', () => {
  it('loads one directory for a large description and preserves every paragraph', () => {
    const body = Array.from(
      { length: 1000 },
      (_entry, index) => `Paragraph ${index}: ask @ada for **review**.`,
    ).join('\n\n');
    const { container, rerender } = render(
      <MentionText body={body} organizationId="org_1" />,
    );

    expect(container.querySelectorAll('p')).toHaveLength(1000);
    expect(screen.getAllByText('@Ada')).toHaveLength(1000);
    expect(performance.directoryRead).toHaveBeenCalledTimes(1);
    expect(performance.markdownRender).toHaveBeenCalledTimes(1);

    rerender(<MentionText body={body} organizationId="org_1" />);
    expect(performance.directoryRead).toHaveBeenCalledTimes(1);
    expect(performance.markdownRender).toHaveBeenCalledTimes(1);
  });

  it('shares one directory across many comments and their list leaves', () => {
    const { container } = render(
      <TaskActorDirectoryProvider organizationId="org_1" projectId="proj_1">
        {Array.from({ length: 100 }, (_entry, index) => (
          <MentionText
            key={index}
            body={`Comment ${index}\n\n- Ask @ada\n- Ask @pr.reviewer`}
            organizationId="org_1"
            projectId="proj_1"
          />
        ))}
      </TaskActorDirectoryProvider>,
    );

    expect(container.querySelectorAll('li')).toHaveLength(200);
    expect(screen.getAllByText('@Ada')).toHaveLength(100);
    expect(screen.getAllByText('@PR Reviewer')).toHaveLength(100);
    expect(performance.directoryRead).toHaveBeenCalledTimes(1);
  });

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

  it('resolves an automation by store name AND by display-name handle', () => {
    render(
      <MentionText
        body="@vat-return-desk redo — @swiss.vat.return.desk agreed"
        organizationId="org_1"
      />,
    );

    expect(screen.getAllByText('@Swiss VAT return desk')).toHaveLength(2);
    expect(screen.queryByText(/@vat-return-desk/)).not.toBeInTheDocument();
  });
});
