import { createFileRoute } from '@tanstack/react-router';
import { Languages, Loader2, Plus } from 'lucide-react';
import { useState, useCallback, useEffect, useMemo } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { ReorderList } from '@/app/components/ui/forms/reorder-list';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { LocaleTabs } from '@/app/components/ui/navigation/locale-tabs';
import { Button } from '@/app/components/ui/primitives/button';
import { useTranslateAgentFields } from '@/app/features/agents/hooks/mutations';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  MAX_CONVERSATION_STARTER_LENGTH,
  MAX_CONVERSATION_STARTERS,
  SUPPORTED_AGENT_LOCALES,
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

  const localeTabs = useMemo(() => {
    const tabs: { locale: string; isDefault: boolean }[] = [];
    tabs.push({ locale: defaultLocale, isDefault: true });
    for (const locale of SUPPORTED_AGENT_LOCALES) {
      if (locale !== defaultLocale) {
        tabs.push({ locale, isDefault: false });
      }
    }
    return tabs;
  }, [defaultLocale]);

  const sourceStarters = config.conversationStarters ?? [];

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
      if (editingLocale === null) {
        const filtered = toStrings(newItems)
          .map((s) => s.trim())
          .filter(Boolean);
        updateConfig({
          conversationStarters: filtered.length ? filtered : undefined,
        });
      } else {
        // For override locales, preserve slot positions (keep empty strings)
        const strings = toStrings(newItems).map((s) => s.trim());
        const hasAny = strings.some(Boolean);
        const existingI18n = config.i18n ?? {};
        const existingOverrides = existingI18n[editingLocale] ?? {};
        updateConfig({
          i18n: {
            ...existingI18n,
            [editingLocale]: {
              ...existingOverrides,
              conversationStarters: hasAny ? strings : undefined,
            },
          },
        });
      }
    },
    [updateConfig, editingLocale, config.i18n],
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

  const canAutoTranslate = editingLocale !== null && sourceStarters.length > 0;
  const isEditingOverride = editingLocale !== null;

  async function handleAutoTranslate() {
    if (!editingLocale || sourceStarters.length === 0) return;

    const targetLocale = editingLocale;

    try {
      const result = await translateMutation.mutateAsync({
        fields: { conversationStarters: sourceStarters },
        targetLocale,
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
    <ContentArea gap={6} className="mx-auto max-w-3xl px-4 py-4">
      <StickySectionHeader
        title={t('agents.conversationStarters.title')}
        description={t('agents.conversationStarters.description')}
      />

      <LocaleTabs
        tabs={localeTabs}
        activeLocale={editingLocale}
        onLocaleChange={setEditingLocale}
        disabled={translateMutation.isPending}
        hasContent={hasLocaleContent}
        defaultLabel={t('agents.conversationStarters.default')}
        untranslatedLabel={t('agents.conversationStarters.untranslated')}
        actions={
          canAutoTranslate ? (
            <button
              type="button"
              onClick={handleAutoTranslate}
              disabled={translateMutation.isPending}
              className="text-muted-foreground hover:text-foreground ml-auto flex shrink-0 items-center gap-1 pb-2 text-sm transition-colors disabled:opacity-50"
            >
              {translateMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Languages className="size-3.5" />
              )}
              {t('agents.conversationStarters.autoTranslate')}
            </button>
          ) : undefined
        }
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
            <div className="flex items-center gap-2">
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
            </div>
          )}
        />

        {!isEditingOverride && items.length < MAX_CONVERSATION_STARTERS && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleAdd}
            className="self-start"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('agents.conversationStarters.add')}
          </Button>
        )}
      </FormSection>
    </ContentArea>
  );
}
