import { createFileRoute } from '@tanstack/react-router';
import { Reorder } from 'framer-motion';
import { ChevronDown, ChevronUp, GripVertical, Plus, X } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { Button } from '@/app/components/ui/primitives/button';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { useT } from '@/lib/i18n/client';
import {
  MAX_CONVERSATION_STARTER_LENGTH,
  MAX_CONVERSATION_STARTERS,
} from '@/lib/shared/constants/agents';
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
  const { config, updateConfig } = useAgentConfig();

  const [items, setItems] = useState<StarterItem[]>(() =>
    toItems(config.conversationStarters ?? []),
  );

  const startersKey = JSON.stringify(config.conversationStarters ?? []);
  useEffect(() => {
    setItems(toItems(config.conversationStarters ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startersKey]);

  const syncToConfig = useCallback(
    (newItems: StarterItem[]) => {
      const filtered = toStrings(newItems)
        .map((s) => s.trim())
        .filter(Boolean);
      updateConfig({
        conversationStarters: filtered.length ? filtered : undefined,
      });
    },
    [updateConfig],
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

  return (
    <ContentArea gap={6} className="mx-auto max-w-3xl px-4 py-4">
      <StickySectionHeader
        title={t('agents.conversationStarters.title')}
        description={t('agents.conversationStarters.description')}
      />

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
