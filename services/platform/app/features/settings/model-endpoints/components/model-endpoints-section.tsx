'use client';

import { Button } from '@tale/ui/button';
import { CodeBlock } from '@tale/ui/code-block';
import { CopyableField } from '@tale/ui/copyable-field';
import { EmptyState } from '@tale/ui/empty-state';
import { Stack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { Ban, TriangleAlert, Unplug } from 'lucide-react';

import { useOrganization } from '@/app/features/organization/hooks/queries';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useMyModelApiAccess } from '@/app/features/settings/governance/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';

/**
 * Settings → API → Models: how a key holder points their own tools at the
 * model endpoints for API keys — the two base URLs, the organization slug,
 * the models they may call, and copyable setup for opencode, Claude Code and
 * the OpenAI SDK. The endpoints are the organization's to turn on (Governance
 * → Models → Model access); until then, and for a member who may not call
 * them, the page says so instead of showing setup that would be refused.
 */

/** What every snippet names. */
export interface SnippetFacts {
  /** `https://<host>/api/v1/openai` */
  openaiBaseUrl: string;
  /** `https://<host>/api/v1/anthropic` */
  anthropicBaseUrl: string;
  orgSlug: string;
  /** A model id both wires take (`<provider>/<model>`). */
  model: string;
  /** The model's display name, for opencode's picker. */
  modelLabel: string;
}

/** opencode's provider entry (`opencode.json`), through the AI SDK's
 * OpenAI-compatible provider — the key read from `TALE_API_KEY`. */
export function openCodeSnippet(facts: SnippetFacts): string {
  return JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        tale: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Tale',
          options: {
            baseURL: facts.openaiBaseUrl,
            apiKey: '{env:TALE_API_KEY}',
            headers: { 'X-Organization-Slug': facts.orgSlug },
          },
          models: { [facts.model]: { name: facts.modelLabel } },
        },
      },
      model: `tale/${facts.model}`,
    },
    null,
    2,
  );
}

/** Claude Code's environment: the Anthropic base URL, the key as a bearer
 * token, the organization header, the model for the main loop and for the
 * background tasks — and `ANTHROPIC_API_KEY` unset, since the `x-api-key`
 * it would send is refused. */
export function claudeCodeSnippet(facts: SnippetFacts): string {
  return [
    `export ANTHROPIC_BASE_URL="${facts.anthropicBaseUrl}"`,
    'export ANTHROPIC_AUTH_TOKEN="<api-key>"',
    `export ANTHROPIC_CUSTOM_HEADERS="X-Organization-Slug: ${facts.orgSlug}"`,
    `export ANTHROPIC_MODEL="${facts.model}"`,
    `export ANTHROPIC_DEFAULT_HAIKU_MODEL="${facts.model}"`,
    'unset ANTHROPIC_API_KEY',
    'claude',
  ].join('\n');
}

/** A Python script on the OpenAI SDK. */
export function openAiSdkSnippet(facts: SnippetFacts): string {
  return [
    'from openai import OpenAI',
    '',
    'client = OpenAI(',
    `    base_url="${facts.openaiBaseUrl}",`,
    '    api_key="<api-key>",',
    `    default_headers={"X-Organization-Slug": "${facts.orgSlug}"},`,
    ')',
    'reply = client.chat.completions.create(',
    `    model="${facts.model}",`,
    '    messages=[{"role": "user", "content": "Hello"}],',
    ')',
    'print(reply.choices[0].message.content)',
  ].join('\n');
}

const MODEL_PLACEHOLDER = '<model-id>';

export function ModelEndpointsSection({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const ability = useAbility();
  // Canonical deployment URL (SITE_URL), not the browser origin — the same
  // base the MCP endpoint row names.
  const siteOrigin = useSiteUrl();
  const organization = useOrganization(organizationId);
  const access = useMyModelApiAccess(organizationId);

  if (access.isLoading) {
    return (
      <Skeletonize loading label={t('modelEndpoints.title')}>
        <SettingsSection
          title={t('modelEndpoints.title')}
          description={t('modelEndpoints.description')}
        >
          <SettingsFieldList>
            {['openai', 'anthropic', 'slug'].map((row) => (
              <SettingsFieldRow key={row} label={<SkeletonText />}>
                <SkeletonText />
              </SettingsFieldRow>
            ))}
          </SettingsFieldList>
        </SettingsSection>
      </Skeletonize>
    );
  }

  const standing = access.data;
  if (standing === undefined) {
    return (
      <EmptyState
        icon={TriangleAlert}
        headingLevel={2}
        title={t('modelEndpoints.loadFailed')}
        action={
          <Button variant="secondary" onClick={() => void access.refetch()}>
            {tCommon('actions.tryAgain')}
          </Button>
        }
      />
    );
  }

  if (!standing.enabled) {
    return (
      <EmptyState
        icon={Unplug}
        headingLevel={2}
        title={t('modelEndpoints.disabled.title')}
        description={t('modelEndpoints.disabled.description')}
        action={
          ability.can('write', 'orgSettings') ? (
            <Button variant="secondary" asChild>
              <Link
                to="/dashboard/$id/settings/governance/content-models"
                params={{ id: organizationId }}
              >
                {t('modelEndpoints.disabled.openPolicy')}
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (!standing.allowed) {
    return (
      <EmptyState
        icon={Ban}
        headingLevel={2}
        title={t('modelEndpoints.forbidden.title')}
        description={t('modelEndpoints.forbidden.description')}
      />
    );
  }

  const orgSlug = organization.data?.slug ?? '<org-slug>';
  const firstModel = standing.models[0];
  const facts: SnippetFacts = {
    openaiBaseUrl: `${siteOrigin}/api/v1/openai`,
    anthropicBaseUrl: `${siteOrigin}/api/v1/anthropic`,
    orgSlug,
    model: firstModel?.id ?? MODEL_PLACEHOLDER,
    modelLabel: firstModel?.label ?? MODEL_PLACEHOLDER,
  };
  const snippets = [
    { key: 'opencode', value: openCodeSnippet(facts) },
    { key: 'claudeCode', value: claudeCodeSnippet(facts) },
    { key: 'openaiSdk', value: openAiSdkSnippet(facts) },
  ] as const;

  return (
    <>
      <SettingsSection
        title={t('modelEndpoints.title')}
        description={
          <>
            {t('modelEndpoints.description')}{' '}
            {t('modelEndpoints.governanceNote')}
          </>
        }
      >
        {/* Same divided rows as every settings section — label + hint left,
            the value pinned right. */}
        <SettingsFieldList>
          <SettingsFieldRow
            label={t('modelEndpoints.openaiUrl.label')}
            description={t('modelEndpoints.openaiUrl.description')}
          >
            <CopyableField
              value={facts.openaiBaseUrl}
              mono
              copyAriaLabel={t('modelEndpoints.openaiUrl.copy')}
            />
          </SettingsFieldRow>
          <SettingsFieldRow
            label={t('modelEndpoints.anthropicUrl.label')}
            description={t('modelEndpoints.anthropicUrl.description')}
          >
            <CopyableField
              value={facts.anthropicBaseUrl}
              mono
              copyAriaLabel={t('modelEndpoints.anthropicUrl.copy')}
            />
          </SettingsFieldRow>
          <SettingsFieldRow
            label={t('modelEndpoints.apiKey.label')}
            description={
              <>
                {t('modelEndpoints.apiKey.description')}{' '}
                <Link
                  to="/dashboard/$id/settings/api/rest"
                  params={{ id: organizationId }}
                  className="underline"
                >
                  {t('modelEndpoints.apiKey.link')}
                </Link>
              </>
            }
          >
            <Text as="span" variant="muted" className="font-mono text-xs">
              Authorization: Bearer &lt;api-key&gt;
            </Text>
          </SettingsFieldRow>
          {organization.data?.slug !== undefined && (
            <SettingsFieldRow
              label={t('modelEndpoints.orgSlug.label')}
              description={t('modelEndpoints.orgSlug.description')}
            >
              <CopyableField
                value={organization.data.slug}
                mono
                copyAriaLabel={t('modelEndpoints.orgSlug.copy')}
              />
            </SettingsFieldRow>
          )}
          <SettingsFieldRow
            label={t('modelEndpoints.models.label')}
            description={t('modelEndpoints.models.description')}
          >
            {standing.models.length === 0 ? (
              <Text as="span" variant="muted" className="text-sm">
                {t('modelEndpoints.models.empty')}
              </Text>
            ) : (
              <Stack gap={1} as="ul" className="w-full">
                {standing.models.map((model) => (
                  <li key={model.id}>
                    <CopyableField
                      value={model.id}
                      mono
                      copyAriaLabel={t('modelEndpoints.models.copy', {
                        id: model.id,
                      })}
                    />
                  </li>
                ))}
              </Stack>
            )}
          </SettingsFieldRow>
        </SettingsFieldList>
      </SettingsSection>

      {snippets.map((snippet) => (
        <SettingsSection
          key={snippet.key}
          title={t(`modelEndpoints.${snippet.key}.title`)}
          description={t(`modelEndpoints.${snippet.key}.description`)}
        >
          <CodeBlock
            copyValue={snippet.value}
            copyLabel={t(`modelEndpoints.${snippet.key}.copy`)}
          >
            {snippet.value}
          </CodeBlock>
        </SettingsSection>
      ))}
    </>
  );
}
