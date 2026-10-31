/**
 * Settings > Governance > Policies & Limits: whether chat in the
 * organization can make files, run code, use skills and make images, and
 * what stands in the way where it cannot (#5030). Owners and admins only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ChatWorkToolReason,
  ChatWorkToolsStatus,
} from '@/lib/chat/work-tools-status';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { ChatToolStatus } from './chat-tool-status';

const { query, ability, useChatWorkToolsStatus } = vi.hoisted(() => {
  const result = {
    data: undefined as ChatWorkToolsStatus | undefined,
    isError: false,
    isFetching: false,
    errorUpdateCount: 0,
    refetch: vi.fn(),
  };
  return {
    query: result,
    ability: { admin: true },
    useChatWorkToolsStatus: vi.fn(() => result),
  };
});

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: (action: string, subject: string) =>
      action === 'read' && subject === 'orgSettings' && ability.admin,
  }),
}));
vi.mock('../hooks/queries', () => ({ useChatWorkToolsStatus }));

const CHECKED_AT = Date.UTC(2026, 9, 30, 9, 15);

function status(
  overrides: Partial<
    Record<'files' | 'code' | 'skills' | 'images', ChatWorkToolReason[]>
  > = {},
  imageModel?: ChatWorkToolsStatus['imageModel'],
): ChatWorkToolsStatus {
  const limiting = new Set(['sandbox_start_failed', 'document_skills_missing']);
  return {
    checkedAt: CHECKED_AT,
    tools: (['files', 'code', 'skills', 'images'] as const).map((tool) => {
      const reasons = overrides[tool] ?? [];
      return {
        tool,
        state:
          reasons.length === 0
            ? 'available'
            : reasons.every((reason) => limiting.has(reason.code))
              ? 'limited'
              : 'unavailable',
        reasons,
      };
    }),
    ...(imageModel !== undefined ? { imageModel } : {}),
  };
}

function row(name: string) {
  const list = screen.getByRole('list', { name: 'Chat tool status' });
  const item = within(list)
    .getAllByRole('listitem')
    .find((li) => within(li).queryByText(name, { exact: true }) !== null);
  if (item === undefined) throw new Error(`no row for ${name}`);
  return item;
}

beforeEach(() => {
  query.data = undefined;
  query.isError = false;
  query.isFetching = false;
  query.errorUpdateCount = 0;
  query.refetch.mockReset();
  ability.admin = true;
  useChatWorkToolsStatus.mockClear();
});

describe('ChatToolStatus [CHAT-R35]', () => {
  it('lists each tool with its state and what stands in its way', async () => {
    query.data = status({
      code: [
        {
          code: 'sandbox_start_failed',
          failure: 'sandbox_not_ready',
          at: CHECKED_AT - 60_000,
        },
      ],
      skills: [{ code: 'document_skills_missing', missing: ['pptx', 'xlsx'] }],
      images: [{ code: 'image_generation_off' }, { code: 'no_image_model' }],
    });
    const { container } = render(<ChatToolStatus organizationId="org-1" />);

    expect(useChatWorkToolsStatus).toHaveBeenCalledWith('org-1', {
      enabled: true,
    });
    expect(within(row('Files')).getByText('Available')).toBeInTheDocument();
    expect(within(row('Code')).getByText('Limited')).toBeInTheDocument();
    expect(
      within(row('Code')).getByText(
        /^Last sandbox start, .+: The sandbox isn't ready yet\.$/,
      ),
    ).toBeInTheDocument();
    expect(within(row('Skills')).getByText('Limited')).toBeInTheDocument();
    expect(
      within(row('Skills')).getByText(
        "Document skills missing from the organization's skill library: pptx and xlsx.",
      ),
    ).toBeInTheDocument();
    const images = row('Images');
    expect(within(images).getByText('Unavailable')).toBeInTheDocument();
    expect(
      within(images).getByText(
        'Image generation is switched off under Models.',
      ),
    ).toBeInTheDocument();
    expect(
      within(images).getByText('No connected provider offers an image model.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Checked at /)).toBeInTheDocument();
    await checkAccessibility(container);
  });

  it.each<[ChatWorkToolReason, 'files' | 'code' | 'skills' | 'images', string]>(
    [
      [
        { code: 'policy_off' },
        'files',
        'Switched off under Chat tools on this page.',
      ],
      [
        { code: 'policy_unreadable' },
        'skills',
        "The Chat tools policy can't be read, which keeps this tool off until it's repaired.",
      ],
      [
        { code: 'sandbox_not_configured' },
        'code',
        'No sandbox service is set up for this deployment, so no code can run.',
      ],
      [
        { code: 'sandbox_unreachable' },
        'code',
        "The sandbox service didn't answer just now, so no code can run.",
      ],
      [
        { code: 'skill_library_unreadable' },
        'skills',
        "The organization's skill library can't be read.",
      ],
      [
        { code: 'image_policy_unreadable' },
        'images',
        "The Image generation policy can't be read.",
      ],
      [
        { code: 'image_model_unavailable' },
        'images',
        "The image model chosen under Models can't be used.",
      ],
      [
        { code: 'image_model_outside_eu' },
        'images',
        "This organization processes prompts only in the EU/EEA, and the image model's endpoint isn't known to process there.",
      ],
      [
        { code: 'model_access_unreadable' },
        'images',
        "The Model access policy can't be read, so Tale can't tell whether prompts must stay in the EU/EEA.",
      ],
      [
        { code: 'image_model_check_failed' },
        'images',
        "The image models couldn't be checked.",
      ],
    ],
  )('says %j on the %s row', (reason, tool, text) => {
    query.data = status({ [tool]: [reason] });
    render(<ChatToolStatus organizationId="org-1" />);

    const label = {
      files: 'Files',
      code: 'Code',
      skills: 'Skills',
      images: 'Images',
    }[tool];
    expect(within(row(label)).getByText('Unavailable')).toBeInTheDocument();
    expect(within(row(label)).getByText(text)).toBeInTheDocument();
  });

  it('names the image model when images are available', () => {
    query.data = status({}, { providerName: 'OpenAI', modelId: 'gpt-image-1' });
    render(<ChatToolStatus organizationId="org-1" />);

    expect(within(row('Images')).getByText('Available')).toBeInTheDocument();
    expect(
      within(row('Images')).getByText('Uses gpt-image-1 from OpenAI.'),
    ).toBeInTheDocument();
  });

  it('checks again on request, and not twice while a check runs', async () => {
    query.data = status();
    const { user, rerender } = render(
      <ChatToolStatus organizationId="org-1" />,
    );

    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(query.refetch).toHaveBeenCalledTimes(1);

    query.isFetching = true;
    rerender(<ChatToolStatus organizationId="org-1" />);
    const button = screen.getByRole('button', { name: 'Check again' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(button);
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it('says so when the tools could not be checked, and checks again from there', async () => {
    query.isError = true;
    query.errorUpdateCount = 1;
    const { user } = render(<ChatToolStatus organizationId="org-1" />);

    expect(
      screen.getByText("Couldn't check the chat tools."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the last check when a new one fails', () => {
    query.data = status({ code: [{ code: 'sandbox_unreachable' }] });
    query.isError = true;
    query.errorUpdateCount = 1;
    render(<ChatToolStatus organizationId="org-1" />);

    expect(
      screen.getByText(
        "Couldn't check the chat tools again. This shows the last check.",
      ),
    ).toBeInTheDocument();
    expect(within(row('Code')).getByText('Unavailable')).toBeInTheDocument();
  });

  it('masks the four tools while the first check runs', () => {
    query.isFetching = true;
    render(<ChatToolStatus organizationId="org-1" />);

    for (const name of ['Files', 'Code', 'Skills', 'Images']) {
      expect(row(name)).toBeInTheDocument();
    }
    expect(screen.queryByText(/^Checked at /)).not.toBeInTheDocument();
  });

  it('shows nothing to anyone but owners and admins, and reads nothing', () => {
    ability.admin = false;
    const { container } = render(<ChatToolStatus organizationId="org-1" />);

    expect(container).toBeEmptyDOMElement();
    expect(useChatWorkToolsStatus).toHaveBeenCalledWith('org-1', {
      enabled: false,
    });
  });
});
