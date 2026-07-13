import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';

import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { ReorderList } from '@/app/components/ui/forms/reorder-list';
import { LocaleTabs } from '@/app/components/ui/i18n/locale-tabs';
import { AgentTabContent } from '@/app/features/agents/components/agent-tab-content';
import { useTranslateAgentFields } from '@/app/features/agents/hooks/mutations';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  MAX_CONVERSATION_STARTER_LENGTH,
  MAX_CONVERSATION_STARTERS,
} from '@/lib/shared/constants/agents';
import { getOrganizationDefaultLocale } from '@/lib/shared/utils/get-organization-default-locale';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/agents/$agentId/conversation-starters',
)({
  head: () => ({
    meta: seo('agentSettings'),
  }),
  component: ConversationStartersTab,
});

interface StarterItem {
  id: string;
  text: string;
}

function toItems(starters: string[]): StarterItem[] {
  return starters.map((text) => ({ id: crypto.randomUUID(), text }));
}

function toStrings(items: StarterItem[]): string[] {
  return items.map((item) => item.text);
}

function ConversationStartersTab() {
  const { t } = useT('settings');
  const { id: organizationId } = Route.useParams();
  const { config, updateConfig } = useAgentConfig();
  const { data: organization } = useOrganization(organizationId);
  const translateMutation = useTranslateAgentFields();
  const { toast } = useToast();

  const defaultLocale = getOrganizationDefaultLocale(organization?.metadata);

  const [editingLocale, setEditingLocale] = useState<string | null>(null);

  // i18n-first: the "source" for slot count and auto-translate is the default
  // locale's i18n entry, falling back to the legacy top-level field so old
  // agents continue to render until their next edit migrates content into
  // i18n.<default-locale>.
  const sourceStarters =
    config.i18n?.[defaultLocale]?.conversationStarters ??
    config.conversationStarters ??
    [];

  function getStarters(): string[] {
    if (editingLocale === null) {
      return sourceStarters;
    }
    const overrides = config.i18n?.[editingLocale]?.conversationStarters ?? [];
    // Sync slot count with default locale: pad with empty strings or trim to match
    if (overrides.length < sourceStarters.length) {
      return [
        ...overrides,
        ...Array.from<string>({
          length: sourceStarters.length - overrides.length,
        }).fill(''),
      ];
    }
    return overrides.slice(0, sourceStarters.length);
  }

  const [items, setItems] = useState<StarterItem[]>(() =>
    toItems(getStarters()),
  );

  const startersKey = JSON.stringify(getStarters());
  useEffect(() => {
    setItems(toItems(getStarters()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startersKey, editingLocale]);

  const syncToConfig = useCallback(
    (newItems: StarterItem[]) => {
      const targetLocale = editingLocale ?? defaultLocale;
      // Default tab: full trim+filter (source). Non-default tab: preserve slot
      // positions via empty strings so translations align 1:1 with the source.
      const strings = toStrings(newItems).map((s) => s.trim());
      const isDefaultTab = editingLocale === null;
      const value = isDefaultTab
        ? strings.filter(Boolean).length
          ? strings.filter(Boolean)
          : undefined
        : strings.some(Boolean)
          ? strings
          : undefined;

      const existingI18n = config.i18n ?? {};
      const existingOverrides = existingI18n[targetLocale] ?? {};
      // Server-side normalization retires the legacy top-level
      // `conversationStarters` at the write boundary (I-1), so the UI just
      // writes into i18n[targetLocale].
      updateConfig({
        i18n: {
          ...existingI18n,
          [targetLocale]: {
            ...existingOverrides,
            conversationStarters: value,
          },
        },
      });
    },
    [updateConfig, editingLocale, defaultLocale, config.i18n],
  );

  const handleChange = useCallback((id: string, value: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, text: value } : item)),
    );
  }, []);

  const handleBlur = useCallback(() => {
    syncToConfig(items);
  }, [items, syncToConfig]);

  const handleAdd = useCallback(() => {
    setItems((prev) => [...prev, { id: crypto.randomUUID(), text: '' }]);
  }, []);

  const handleRemove = useCallback(
    (id: string) => {
      setItems((prev) => {
        const next = prev.filter((item) => item.id !== id);
        syncToConfig(next);
        return next;
      });
    },
    [syncToConfig],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index === 0) return;
      setItems((prev) => {
        const next = [...prev];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        syncToConfig(next);
        return next;
      });
    },
    [syncToConfig],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      setItems((prev) => {
        if (index >= prev.length - 1) return prev;
        const next = [...prev];
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        syncToConfig(next);
        return next;
      });
    },
    [syncToConfig],
  );

  const handleReorder = useCallback(
    (newItems: StarterItem[]) => {
      setItems(newItems);
      syncToConfig(newItems);
    },
    [syncToConfig],
  );

  function hasLocaleContent(locale: string) {
    const starters = config.i18n?.[locale]?.conversationStarters;
    return !!starters && starters.length > 0;
  }

  const isEditingOverride = editingLocale !== null;

  async function handleAutoTranslate() {
    if (!editingLocale || sourceStarters.length === 0) return;

    const targetLocale = editingLocale;

    try {
      const result = await translateMutation.mutateAsync({
        fields: { conversationStarters: sourceStarters },
        targetLocale,
        organizationId,
      });

      if (result.error) {
        toast({
          title: t('agents.conversationStarters.translateError'),
          variant: 'destructive',
        });
        return;
      }

      const translated = result.translated.conversationStarters;
      if (!Array.isArray(translated)) return;

      const newItems = toItems(translated);

      if (editingLocale !== targetLocale) return;

      setItems(newItems);
      syncToConfig(newItems);
    } catch (error) {
      console.error('[auto-translate]', error);
      toast({
        title: t('agents.conversationStarters.translateError'),
        variant: 'destructive',
      });
    }
  }

  return (
    <AgentTabContent>
      {/* No tab-level heading — the tab strip already names the tab (the same
          no-page-title rule as settings pages); the description leads alone. */}
      <Text variant="muted" className="text-sm">
        {t('agents.conversationStarters.description')}
      </Text>

      {/* Shared per-locale tab scaffold — the same LocaleTabs the General and
          Instructions tabs use (this file used to carry a byte-identical
          hand-rolled copy of it). */}
      <LocaleTabs
        defaultLocale={defaultLocale}
        editingLocale={editingLocale ?? defaultLocale}
        onEditingLocaleChange={(v) =>
          setEditingLocale(v === defaultLocale ? null : v)
        }
        hasTranslation={hasLocaleContent}
        onAutoTranslate={
          sourceStarters.length > 0
            ? () => void handleAutoTranslate()
            : undefined
        }
        isTranslating={translateMutation.isPending}
      />

      <FormSection>
        <ReorderList
          items={items}
          onReorder={handleReorder}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onRemove={handleRemove}
          readonlyOrder={isEditingOverride}
          moveUpLabel={t('agents.conversationStarters.moveUp')}
          moveDownLabel={t('agents.conversationStarters.moveDown')}
          dragHandleLabel={t('agents.conversationStarters.dragHandle')}
          removeLabel={t('agents.conversationStarters.remove')}
          renderItem={({ item, index }) => (
            <Row gap={2}>
              <span className="text-muted-foreground text-sm">
                {index + 1}.
              </span>
              <Input
                value={item.text}
                onChange={(e) => handleChange(item.id, e.target.value)}
                onBlur={handleBlur}
                placeholder={t('agents.conversationStarters.placeholder')}
                maxLength={MAX_CONVERSATION_STARTER_LENGTH}
                wrapperClassName="min-w-0 flex-1"
              />
            </Row>
          )}
        />

        {!isEditingOverride && items.length < MAX_CONVERSATION_STARTERS && (
          <Button
            type="button"
            variant="secondary"
            onClick={handleAdd}
            className="self-start"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('agents.conversationStarters.add')}
          </Button>
        )}
      </FormSection>
    </AgentTabContent>
  );
}
