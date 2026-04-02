import { createFileRoute } from '@tanstack/react-router';
import { Reorder } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Languages,
  Loader2,
  Plus,
  X,
} from 'lucide-react';
import { useState, useCallback, useEffect, useMemo } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
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
import { cn } from '@/lib/utils/cn';
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

import { getOrganizationDefaultLocale } from '@/lib/shared/utils/get-organization-default-locale';

function ConversationStartersTab() {
  const { t } = useT('settings');
  const { t: tGlobal } = useT('global');
  const { id: organizationId } = Route.useParams();
  const { config, updateConfig } = useAgentConfig();
  const { data: organization } = useOrganization(organizationId);
  const translateMutation = useTranslateAgentFields();
  const { toast } = useToast();

  const defaultLocale = getOrganizationDefaultLocale(organization?.metadata);

  // null = editing the default locale (top-level conversationStarters)
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

  function getStarters(): string[] {
    if (editingLocale === null) {
      return config.conversationStarters ?? [];
    }
    return config.i18n?.[editingLocale]?.conversationStarters ?? [];
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
      const filtered = toStrings(newItems)
        .map((s) => s.trim())
        .filter(Boolean);
      const value = filtered.length ? filtered : undefined;

      if (editingLocale === null) {
        updateConfig({ conversationStarters: value });
      } else {
        const existingI18n = config.i18n ?? {};
        const existingOverrides = existingI18n[editingLocale] ?? {};
        updateConfig({
          i18n: {
            ...existingI18n,
            [editingLocale]: {
              ...existingOverrides,
              conversationStarters: value,
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
    return starters && starters.length > 0;
  }

  const sourceStarters = config.conversationStarters ?? [];
  const canAutoTranslate = editingLocale !== null && sourceStarters.length > 0;

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

      // Guard against locale tab switch during in-flight translation
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

      <div className="scrollbar-hide border-border flex items-center gap-4 overflow-x-auto border-b">
        {localeTabs.map(({ locale, isDefault }) => {
          const active = isDefault
            ? editingLocale === null
            : editingLocale === locale;
          return (
            <button
              key={locale}
              type="button"
              disabled={translateMutation.isPending}
              onClick={() => setEditingLocale(isDefault ? null : locale)}
              className={cn(
                'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap pb-2 text-sm font-medium transition-colors',
                active
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tGlobal(`languages.${locale}`)}
              {isDefault && (
                <span className="text-muted-foreground text-xs">
                  ({t('agents.conversationStarters.default')})
                </span>
              )}
              {!isDefault && !hasLocaleContent(locale) && (
                <span className="bg-muted text-muted-foreground rounded px-1 py-0.5 text-[10px] leading-none">
                  {t('agents.conversationStarters.untranslated')}
                </span>
              )}
              {active && (
                <span className="bg-foreground absolute bottom-0 left-0 h-0.5 w-full" />
              )}
            </button>
          );
        })}

        {canAutoTranslate && (
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
        )}
      </div>

      <FormSection>
        <Reorder.Group
          axis="y"
          values={items}
          onReorder={handleReorder}
          className="flex flex-col gap-3"
        >
          {items.map((item, index) => (
            <Reorder.Item
              key={item.id}
              value={item}
              className="flex items-start gap-2"
              dragListener={false}
            >
              <Reorder.Item
                as="button"
                value={item}
                type="button"
                className="text-muted-foreground hover:text-foreground mt-2 shrink-0 cursor-grab active:cursor-grabbing"
                aria-label={t('agents.conversationStarters.dragHandle')}
              >
                <GripVertical className="h-4 w-4" />
              </Reorder.Item>

              <span className="text-muted-foreground mt-2 text-sm">
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

              <div className="mt-0.5 flex shrink-0 flex-col">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => handleMoveUp(index)}
                  disabled={index === 0}
                  aria-label={t('agents.conversationStarters.moveUp')}
                >
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => handleMoveDown(index)}
                  disabled={index === items.length - 1}
                  aria-label={t('agents.conversationStarters.moveDown')}
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-1.5 shrink-0"
                onClick={() => handleRemove(item.id)}
                aria-label={t('agents.conversationStarters.remove')}
              >
                <X className="h-4 w-4" />
              </Button>
            </Reorder.Item>
          ))}
        </Reorder.Group>

        {items.length < MAX_CONVERSATION_STARTERS && (
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
