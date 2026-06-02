'use client';

import { Code, FileText, Globe, Image, Plug } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

interface AgentLike {
  primaryBehavior?: 'chat' | 'image-generation';
  toolNames?: string[];
  integrationBindings?: string[];
}

const WEB_TOOLS = new Set(['web']);
const DOC_TOOLS = new Set([
  'rag_search',
  'document_retrieve',
  'document_find',
  'document_write',
  'pdf',
  'docx',
  'excel',
]);
const CODE_TOOLS = new Set(['run_code']);
const IMAGE_TOOLS = new Set(['image']);

function hasAny(tools: string[] | undefined, set: Set<string>): boolean {
  if (!tools) return false;
  for (const t of tools) {
    if (set.has(t)) return true;
  }
  return false;
}

/**
 * Renders a compact row of capability icons for an agent — `🌐 Web`,
 * `📄 Docs`, `💻 Code`, `🖼 Image`, `🔌 Integrations`. Each icon has a
 * native `title` tooltip so hovering reveals the full capability name.
 */
export function AgentCapabilityBadges({ agent }: { agent: AgentLike }) {
  const { t } = useT('chat');

  const capabilities = useMemo(() => {
    const items: { key: string; icon: typeof Globe; label: string }[] = [];
    if (hasAny(agent.toolNames, WEB_TOOLS)) {
      items.push({
        key: 'web',
        icon: Globe,
        label: t('agentSelector.capabilities.web'),
      });
    }
    if (hasAny(agent.toolNames, DOC_TOOLS)) {
      items.push({
        key: 'docs',
        icon: FileText,
        label: t('agentSelector.capabilities.docs'),
      });
    }
    if (hasAny(agent.toolNames, CODE_TOOLS)) {
      items.push({
        key: 'code',
        icon: Code,
        label: t('agentSelector.capabilities.code'),
      });
    }
    if (
      agent.primaryBehavior === 'image-generation' ||
      hasAny(agent.toolNames, IMAGE_TOOLS)
    ) {
      items.push({
        key: 'image',
        icon: Image,
        label: t('agentSelector.capabilities.image'),
      });
    }
    if (agent.integrationBindings && agent.integrationBindings.length > 0) {
      items.push({
        key: 'integrations',
        icon: Plug,
        label: t('agentSelector.capabilities.integrations'),
      });
    }
    return items;
  }, [agent.primaryBehavior, agent.toolNames, agent.integrationBindings, t]);

  if (capabilities.length === 0) return null;

  return (
    <span
      className="text-muted-foreground flex shrink-0 items-center gap-1.5"
      aria-label={t('agentSelector.capabilities.label')}
    >
      {capabilities.map(({ key, icon: Icon, label }) => (
        <span key={key} title={label} aria-label={label}>
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
      ))}
    </span>
  );
}
