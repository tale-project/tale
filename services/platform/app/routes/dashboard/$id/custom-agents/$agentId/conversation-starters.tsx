import { createFileRoute } from '@tanstack/react-router';
import { Reorder } from 'framer-motion';
import { ChevronDown, ChevronUp, GripVertical, Plus, X } from 'lucide-react';
import { useState, useCallback, useEffect, useMemo } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { Button } from '@/app/components/ui/primitives/button';
import { AutoSaveIndicator } from '@/app/features/custom-agents/components/auto-save-indicator';
import { useUpdateCustomAgent } from '@/app/features/custom-agents/hooks/mutations';
import { useAutoSave } from '@/app/features/custom-agents/hooks/use-auto-save';
import { useCustomAgentVersion } from '@/app/features/custom-agents/hooks/use-custom-agent-version-context';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import {
  MAX_CONVERSATION_STARTER_LENGTH,
  MAX_CONVERSATION_STARTERS,
} from '@/lib/shared/constants/custom-agents';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/custom-agents/$agentId/conversation-starters',
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
  const { agentId } = Route.useParams();
  const { t } = useT('settings');
  const { agent, isReadOnly } = useCustomAgentVersion();
  const updateAgent = useUpdateCustomAgent();

  const [items, setItems] = useState<StarterItem[]>([]);
  const [initialized, setInitialized] = useState(false);

  const startersKey = JSON.stringify(agent?.conversationStarters ?? []);
  useEffect(() => {
    if (!agent) return;
    setItems(toItems(agent.conversationStarters ?? []));
    setInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startersKey, agentId]);

  const saveData = useMemo(
    () => ({ conversationStarters: toStrings(items) }),
    [items],
  );

  const handleSave = useCallback(
    async (data: { conversationStarters: string[] }) => {
      const filtered = data.conversationStarters
        .map((s) => s.trim())
        .filter(Boolean);
      await updateAgent.mutateAsync({
        customAgentId: toId<'customAgents'>(agentId),
        conversationStarters: filtered.length ? filtered : [],
      });
    },
    [agentId, updateAgent],
  );

  const { status, save } = useAutoSave({
    data: saveData,
    onSave: handleSave,
    enabled: initialized && !isReadOnly,
    mode: 'manual',
  });

  const handleChange = useCallback((id: string, value: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, text: value } : item)),
    );
  }, []);

  const handleBlur = useCallback(() => {
    void save();
  }, [save]);

  const handleAdd = useCallback(() => {
    setItems((prev) => [...prev, { id: crypto.randomUUID(), text: '' }]);
  }, []);

  const handleRemove = useCallback(
    (id: string) => {
      setItems((prev) => {
        const next = prev.filter((item) => item.id !== id);
        void save({ conversationStarters: toStrings(next) });
        return next;
      });
    },
    [save],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index === 0) return;
      setItems((prev) => {
        const next = [...prev];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        void save({ conversationStarters: toStrings(next) });
        return next;
      });
    },
    [save],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      setItems((prev) => {
        if (index >= prev.length - 1) return prev;
        const next = [...prev];
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        void save({ conversationStarters: toStrings(next) });
        return next;
      });
    },
    [save],
  );

  const handleReorder = useCallback(
    (newItems: StarterItem[]) => {
      setItems(newItems);
      void save({ conversationStarters: toStrings(newItems) });
    },
    [save],
  );

  return (
    <ContentArea gap={6} className="mx-auto max-w-3xl px-4 py-4">
      <StickySectionHeader
        title={t('customAgents.conversationStarters.title')}
        description={t('customAgents.conversationStarters.description')}
        action={<AutoSaveIndicator status={status} />}
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
                aria-label={t('customAgents.conversationStarters.dragHandle')}
                disabled={isReadOnly}
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
                placeholder={t('customAgents.conversationStarters.placeholder')}
                maxLength={MAX_CONVERSATION_STARTER_LENGTH}
                disabled={isReadOnly}
                wrapperClassName="min-w-0 flex-1"
              />

              <div className="mt-0.5 flex shrink-0 flex-col">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => handleMoveUp(index)}
                  disabled={isReadOnly || index === 0}
                  aria-label={t('customAgents.conversationStarters.moveUp')}
                >
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => handleMoveDown(index)}
                  disabled={isReadOnly || index === items.length - 1}
                  aria-label={t('customAgents.conversationStarters.moveDown')}
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
                disabled={isReadOnly}
                aria-label={t('customAgents.conversationStarters.remove')}
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
            disabled={isReadOnly}
            className="self-start"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('customAgents.conversationStarters.add')}
          </Button>
        )}
      </FormSection>
    </ContentArea>
  );
}
