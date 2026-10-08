// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskActorDirectoryProvider } from '../hooks/task-actor-directory-context';
import { MentionText } from './mention-text';

const performance = vi.hoisted(() => ({
  directoryRead: vi.fn(),
  markdownRender: vi.fn(),
  // Whether the people, agents and automations are still on their way.
  pending: false,
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => {
    performance.directoryRead();
    return {
      members: [{ id: 'u1', name: 'Ada', email: 'ada@example.com' }],
      agents: [
        { id: 'rs774n7chzm7tbf9p5fhsq2xr58br0nb', name: 'PR Reviewer' },
        // Renamed from "Research Bot" after handles came; the newer agent
        // took the old name.
        {
          id: 'agent-qa',
          name: 'QA Bot',
          handle: 'qa-bot',
          legacyHandles: ['research.bot', 'researchbot'],
        },
        {
          id: 'agent-research',
          name: 'Research Bot',
          handle: 'research-bot',
          legacyHandles: [],
        },
      ],
      automations: [{ slug: 'vat-return-desk', name: 'Swiss VAT return desk' }],
      mentionsPending: performance.pending,
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
  performance.pending = false;
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

  it('renders an indented stack trace as code, as imported issues write it', () => {
    const { container } = render(
      <MentionText
        body={'Stack trace:\n\n    Error: boom\n        at foo (a.js:1) @ada'}
        organizationId="org_1"
      />,
    );
    expect(container.querySelector('pre code')).toHaveTextContent(
      'Error: boom at foo (a.js:1) @ada',
    );
    expect(container.querySelector('[data-slot="mention-chip"]')).toBeNull();
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

const QA = '[@Research Bot](mention:agent/agent-qa)';
const DELETED_AGENT = '3f2b8c1e-7d4a-4b6e-9a1c-2e5f8d7b6c40';

describe('MentionText — stored mentions', () => {
  it('shows a stored mention by the current name, with its kind for screen readers', () => {
    const { container } = render(
      <MentionText body={`Ask ${QA} now`} organizationId="org_1" />,
    );
    const chip = container.querySelector('[data-slot="mention-chip"]');
    expect(chip).toHaveTextContent('@QA Bot (mentionChip.kind.agent)');
    expect(chip).toHaveAttribute('title', '@qa-bot · mentionChip.kind.agent');
    expect(screen.queryByText(/mention:/)).not.toBeInTheDocument();
  });

  it('mutes a mention of someone gone, never showing an id', () => {
    const { container } = render(
      <MentionText
        body={`[@Old Bot](mention:agent/gone) and @${DELETED_AGENT}`}
        organizationId="org_1"
      />,
    );
    const chips = container.querySelectorAll('[data-missing="true"]');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent('@Old Bot');
    expect(chips[0]).toHaveAttribute('title', 'timeline.deletedAgent');
    expect(chips[1]).toHaveTextContent('@timeline.deletedAgent');
    expect(container).not.toHaveTextContent(DELETED_AGENT);
  });

  it('shows chips in headings, table cells, bold and lists', () => {
    const body = [
      `# For ${QA}`,
      '',
      '| who |',
      '| --- |',
      '| @ada |',
      '',
      '**@ada** and $5 to @ada and $10',
      '',
      `- ${QA}`,
    ].join('\n');
    const { container } = render(
      <MentionText body={body} organizationId="org_1" />,
    );
    expect(
      container.querySelectorAll('[data-slot="mention-chip"]'),
    ).toHaveLength(5);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '@QA Bot',
    );
  });

  it('leaves code, an escaped @ and an unknown handle as written', () => {
    const { container } = render(
      <MentionText
        body={'`@ada` and \\@ada and @Nobody.\n\n```\n@ada\n```'}
        organizationId="org_1"
      />,
    );
    expect(container.querySelector('[data-slot="mention-chip"]')).toBeNull();
    expect(container).toHaveTextContent('@ada and @ada and @Nobody.');
  });

  it('calls nobody gone while the directory is still on its way', () => {
    performance.pending = true;
    const body = `[@Old Bot](mention:agent/gone) and @${DELETED_AGENT}`;
    const loading = render(<MentionText body={body} organizationId="org_1" />);
    expect(
      loading.container.querySelectorAll('[data-missing="true"]'),
    ).toHaveLength(0);
    const chips = loading.container.querySelectorAll(
      '[data-slot="mention-chip"]',
    );
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent('@Old Bot');
    expect(chips[1]).toHaveTextContent('@mentionChip.kind.agent');
    expect(loading.container).not.toHaveTextContent(DELETED_AGENT);
    expect(loading.container).not.toHaveTextContent('timeline.deletedAgent');
    loading.unmount();

    performance.pending = false;
    const settled = render(<MentionText body={body} organizationId="org_1" />);
    expect(
      settled.container.querySelectorAll('[data-missing="true"]'),
    ).toHaveLength(2);
  });

  it('reads a typed handle in a comment only as someone it named', () => {
    const { container, rerender } = render(
      <MentionText body="Ping @ada" organizationId="org_1" mentions={[]} />,
    );
    // Saved naming nobody: Ada was not told, so no chip says she was.
    expect(container.querySelector('[data-slot="mention-chip"]')).toBeNull();
    expect(container).toHaveTextContent('Ping @ada');
    rerender(
      <MentionText
        body="Ping @ada"
        organizationId="org_1"
        mentions={[{ type: 'user', id: 'u1' }]}
      />,
    );
    expect(container).toHaveTextContent('Ping @Ada');
  });

  it('keeps a mirrored description’s @names as written', () => {
    const { container } = render(
      <MentionText
        body={`Reported by @ada, assigned to ${QA}`}
        organizationId="org_1"
        plainMentions={false}
      />,
    );
    const chips = container.querySelectorAll('[data-slot="mention-chip"]');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('@QA Bot');
    expect(container).toHaveTextContent('Reported by @ada');
  });

  it('reads an older handle as whom the comment named when two answer to it', () => {
    const { container, rerender } = render(
      <MentionText body="Ping @research.bot" organizationId="org_1" />,
    );
    // What the agent answered to before its rename still names it.
    expect(container).toHaveTextContent('@QA Bot');
    rerender(
      <MentionText
        body="Ping @research.bot"
        organizationId="org_1"
        mentions={[{ type: 'agent', id: 'agent-research' }]}
      />,
    );
    expect(container).toHaveTextContent('@Research Bot');
  });
});
