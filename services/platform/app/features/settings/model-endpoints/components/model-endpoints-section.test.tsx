import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import {
  claudeCodeSnippet,
  ModelEndpointsSection,
  openAiSdkSnippet,
  openCodeSnippet,
  type SnippetFacts,
} from './model-endpoints-section';

/**
 * Settings → API → Models: the page says plainly when the organization has
 * not turned the model endpoints on (with the way to Model access for an
 * admin) or when the member may not call them, and otherwise shows the two
 * base URLs, the organization slug, the models the member may call and the
 * copyable setup for opencode, Claude Code and the OpenAI SDK — built from
 * the same facts, so a copied snippet works as it is.
 */

const state = vi.hoisted(() => ({
  access: {
    isLoading: false,
    data: undefined as
      | undefined
      | {
          enabled: boolean;
          allowed: boolean;
          models: { id: string; label: string }[];
        },
    refetch: vi.fn(),
  },
  admin: true,
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useMyModelApiAccess: () => state.access,
}));

vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://tale.example.com',
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('@/app/features/organization/hooks/queries', () => ({
  useOrganization: () => ({ data: { slug: 'northlight' } }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => state.admin,
    cannot: () => !state.admin,
  }),
}));

const MODELS = [
  { id: 'openrouter/anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
];

beforeEach(() => {
  state.access.isLoading = false;
  state.access.data = { enabled: true, allowed: true, models: MODELS };
  state.access.refetch.mockReset();
  state.admin = true;
});

describe('ModelEndpointsSection', () => {
  it('shows the base URLs, the slug and the callable models', () => {
    render(<ModelEndpointsSection organizationId="org-1" />);

    expect(
      screen.getByText('https://tale.example.com/api/v1/openai'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('https://tale.example.com/api/v1/anthropic'),
    ).toBeInTheDocument();
    expect(screen.getByText('northlight')).toBeInTheDocument();
    // Each id is a copy control named by the id itself.
    for (const model of MODELS) {
      expect(
        screen.getByRole('button', { name: model.id }),
      ).toBeInTheDocument();
    }
    // The key comes from the REST page.
    expect(
      screen.getByRole('link', { name: 'REST API keys.' }),
    ).toHaveAttribute('href', '/dashboard/$id/settings/api/rest');
  });

  it('bakes the facts into the three setups, the first model named', () => {
    render(<ModelEndpointsSection organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: 'opencode' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /"baseURL": "https:\/\/tale\.example\.com\/api\/v1\/openai"/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /export ANTHROPIC_BASE_URL="https:\/\/tale\.example\.com\/api\/v1\/anthropic"/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/model="openrouter\/anthropic\/claude-sonnet-4\.6"/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy Claude Code variables' }),
    ).toBeInTheDocument();
  });

  it('says no model is available yet, and the setups carry a placeholder', () => {
    state.access.data = { enabled: true, allowed: true, models: [] };
    render(<ModelEndpointsSection organizationId="org-1" />);

    expect(
      screen.getByText(/No model is available to you yet/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/export ANTHROPIC_MODEL="<model-id>"/),
    ).toBeInTheDocument();
  });

  it('says the organization has not turned them on, with the way there for an admin', () => {
    state.access.data = { enabled: false, allowed: true, models: [] };
    render(<ModelEndpointsSection organizationId="org-1" />);

    expect(
      screen.getByRole('heading', {
        name: 'Model endpoints are not enabled for your organization',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open model access' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/$id/settings/governance/content-models',
    );
    // No setup a call would be refused for.
    expect(screen.queryByText(/ANTHROPIC_BASE_URL/)).not.toBeInTheDocument();
  });

  it('offers a member no link to a policy they cannot open', () => {
    state.access.data = { enabled: false, allowed: true, models: [] };
    state.admin = false;
    render(<ModelEndpointsSection organizationId="org-1" />);

    expect(
      screen.queryByRole('link', { name: 'Open model access' }),
    ).not.toBeInTheDocument();
  });

  it('says a member without the right cannot call them', () => {
    state.access.data = { enabled: true, allowed: false, models: [] };
    render(<ModelEndpointsSection organizationId="org-1" />);

    expect(
      screen.getByRole('heading', {
        name: 'Your role cannot call the model endpoints',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/api\/v1\/openai/)).not.toBeInTheDocument();
  });

  it('offers to try again when the status cannot be read', async () => {
    state.access.data = undefined;
    const { user } = render(<ModelEndpointsSection organizationId="org-1" />);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.access.refetch).toHaveBeenCalled();
  });

  it('marks the page busy while the status loads', () => {
    state.access.isLoading = true;
    render(<ModelEndpointsSection organizationId="org-1" />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <ModelEndpointsSection organizationId="org-1" />,
    );
    await checkAccessibility(container);
  });
});

describe('the setup snippets', () => {
  const facts: SnippetFacts = {
    openaiBaseUrl: 'https://tale.example.com/api/v1/openai',
    anthropicBaseUrl: 'https://tale.example.com/api/v1/anthropic',
    orgSlug: 'acme',
    model: 'openrouter/anthropic/claude-sonnet-4.6',
    modelLabel: 'Claude Sonnet 4.6',
  };

  it('writes an opencode provider on the OpenAI-compatible SDK provider', () => {
    expect(JSON.parse(openCodeSnippet(facts))).toEqual({
      $schema: 'https://opencode.ai/config.json',
      provider: {
        tale: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Tale',
          options: {
            baseURL: 'https://tale.example.com/api/v1/openai',
            apiKey: '{env:TALE_API_KEY}',
            headers: { 'X-Organization-Slug': 'acme' },
          },
          models: {
            'openrouter/anthropic/claude-sonnet-4.6': {
              name: 'Claude Sonnet 4.6',
            },
          },
        },
      },
      model: 'tale/openrouter/anthropic/claude-sonnet-4.6',
    });
  });

  it('sends Claude Code’s key as a bearer token and never as x-api-key', () => {
    const snippet = claudeCodeSnippet(facts);
    expect(snippet).toContain(
      'export ANTHROPIC_BASE_URL="https://tale.example.com/api/v1/anthropic"',
    );
    expect(snippet).toContain('export ANTHROPIC_AUTH_TOKEN="<api-key>"');
    expect(snippet).toContain(
      'export ANTHROPIC_CUSTOM_HEADERS="X-Organization-Slug: acme"',
    );
    expect(snippet).toContain('unset ANTHROPIC_API_KEY');
    expect(snippet).not.toMatch(/export ANTHROPIC_API_KEY/);
  });

  it('points the OpenAI SDK at the OpenAI-compatible base URL', () => {
    const snippet = openAiSdkSnippet(facts);
    expect(snippet).toContain(
      'base_url="https://tale.example.com/api/v1/openai"',
    );
    expect(snippet).toContain(
      'default_headers={"X-Organization-Slug": "acme"}',
    );
    expect(snippet).toContain('model="openrouter/anthropic/claude-sonnet-4.6"');
  });
});
