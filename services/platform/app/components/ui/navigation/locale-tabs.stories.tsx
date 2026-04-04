import type { Meta, StoryObj } from '@storybook/react';

import { Languages, Loader2, Plus } from 'lucide-react';
import { useState, useCallback } from 'react';

import { Input } from '../forms/input';
import { ReorderList, type ReorderItem } from '../forms/reorder-list';
import { Button } from '../primitives/button';
import { LocaleTabs, type LocaleTab } from './locale-tabs';

const defaultTabs: LocaleTab[] = [
  { locale: 'en', isDefault: true },
  { locale: 'de', isDefault: false },
];

const multiTabs: LocaleTab[] = [
  { locale: 'en', isDefault: true },
  { locale: 'de', isDefault: false },
  { locale: 'es', isDefault: false },
  { locale: 'fr', isDefault: false },
];

function LocaleTabsDemo({
  tabs,
  hasContent,
  actions,
  disabled,
}: {
  tabs: LocaleTab[];
  hasContent?: (locale: string) => boolean;
  actions?: React.ReactNode;
  disabled?: boolean;
}) {
  const [activeLocale, setActiveLocale] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <LocaleTabs
        tabs={tabs}
        activeLocale={activeLocale}
        onLocaleChange={setActiveLocale}
        hasContent={hasContent}
        defaultLabel="default"
        untranslatedLabel="untranslated"
        actions={actions}
        disabled={disabled}
      />
      <p className="text-muted-foreground text-sm">
        Active locale:{' '}
        <code className="text-foreground">
          {activeLocale === null ? 'default' : activeLocale}
        </code>
      </p>
    </div>
  );
}

const meta: Meta<typeof LocaleTabs> = {
  title: 'Navigation/LocaleTabs',
  component: LocaleTabs,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Tab bar for switching between locale-specific content. Highlights the default locale and shows untranslated badges for locales without content.

## Usage
\`\`\`tsx
import { LocaleTabs } from '@/app/components/ui/navigation/locale-tabs';

<LocaleTabs
  tabs={[
    { locale: 'en', isDefault: true },
    { locale: 'de', isDefault: false },
  ]}
  activeLocale={activeLocale}
  onLocaleChange={setActiveLocale}
  defaultLabel="default"
  untranslatedLabel="untranslated"
  hasContent={(locale) => !!translations[locale]}
/>
\`\`\`

## Features
- Underline indicator for active tab
- Default locale badge
- Untranslated badge for locales without content
- Actions slot for extra controls (e.g. auto-translate button)
- Disabled state for all tabs

## Accessibility
- Uses native \`<button>\` elements
- Disabled state prevents interaction during loading
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[480px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof LocaleTabs>;

export const Default: Story = {
  render: () => <LocaleTabsDemo tabs={defaultTabs} />,
};

export const WithUntranslatedBadge: Story = {
  render: () => (
    <LocaleTabsDemo
      tabs={defaultTabs}
      hasContent={(locale) => locale === 'en'}
    />
  ),
};

export const MultipleLocales: Story = {
  render: () => (
    <LocaleTabsDemo
      tabs={multiTabs}
      hasContent={(locale) => locale === 'en' || locale === 'de'}
    />
  ),
};

export const WithActions: Story = {
  render: () => (
    <LocaleTabsDemo
      tabs={defaultTabs}
      hasContent={(locale) => locale === 'en'}
      actions={
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground ml-auto flex shrink-0 items-center gap-1 pb-2 text-sm transition-colors"
        >
          <Languages className="size-3.5" />
          Auto-translate
        </button>
      }
    />
  ),
};

export const Disabled: Story = {
  render: () => (
    <LocaleTabsDemo
      tabs={defaultTabs}
      disabled
      actions={
        <button
          type="button"
          disabled
          className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1 pb-2 text-sm opacity-50"
        >
          <Loader2 className="size-3.5 animate-spin" />
          Auto-translate
        </button>
      }
    />
  ),
};

// -- Combined LocaleTabs + ReorderList story (conversation starters pattern) --

interface StarterItem extends ReorderItem {
  text: string;
}

const MAX_ITEMS = 6;

const defaultStarters = [
  'Help me write a report',
  'Summarize this document',
  'Draft an email response',
];

const translatedStarters: Record<string, string[]> = {
  de: ['Hilf mir einen Bericht zu schreiben', 'Fasse dieses Dokument zusammen'],
};

function toItems(texts: string[]): StarterItem[] {
  return texts.map((text) => ({ id: crypto.randomUUID(), text }));
}

function WithReorderListDemo() {
  const [editingLocale, setEditingLocale] = useState<string | null>(null);
  const isOverride = editingLocale !== null;

  function getStarters(): string[] {
    if (editingLocale === null) return defaultStarters;
    const overrides = translatedStarters[editingLocale] ?? [];
    if (overrides.length < defaultStarters.length) {
      return [
        ...overrides,
        ...Array.from<string>({
          length: defaultStarters.length - overrides.length,
        }).fill(''),
      ];
    }
    return overrides.slice(0, defaultStarters.length);
  }

  const [items, setItems] = useState<StarterItem[]>(() =>
    toItems(getStarters()),
  );

  // Sync items when locale changes
  const localeKey = editingLocale ?? '__default__';
  const [prevLocaleKey, setPrevLocaleKey] = useState(localeKey);
  if (localeKey !== prevLocaleKey) {
    setPrevLocaleKey(localeKey);
    setItems(toItems(getStarters()));
  }

  const handleChange = useCallback((id: string, value: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, text: value } : item)),
    );
  }, []);

  const handleAdd = useCallback(() => {
    setItems((prev) => [...prev, { id: crypto.randomUUID(), text: '' }]);
  }, []);

  const handleRemove = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleMoveUp = useCallback((index: number) => {
    setItems((prev) => {
      if (index === 0) return prev;
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setItems((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <LocaleTabs
        tabs={multiTabs}
        activeLocale={editingLocale}
        onLocaleChange={setEditingLocale}
        hasContent={(locale) => !!translatedStarters[locale]?.length}
        defaultLabel="default"
        untranslatedLabel="untranslated"
        actions={
          isOverride ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground ml-auto flex shrink-0 items-center gap-1 pb-2 text-sm transition-colors"
            >
              <Languages className="size-3.5" />
              Auto-translate
            </button>
          ) : undefined
        }
      />

      <ReorderList
        items={items}
        onReorder={setItems}
        onMoveUp={handleMoveUp}
        onMoveDown={handleMoveDown}
        onRemove={handleRemove}
        readonlyOrder={isOverride}
        moveUpLabel="Move up"
        moveDownLabel="Move down"
        dragHandleLabel="Drag to reorder"
        removeLabel="Remove"
        renderItem={({ item, index }) => (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">{index + 1}.</span>
            <Input
              value={item.text}
              onChange={(e) => handleChange(item.id, e.target.value)}
              placeholder="Enter conversation starter..."
            />
          </div>
        )}
      />

      {!isOverride && items.length < MAX_ITEMS && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleAdd}
          className="self-start"
        >
          <Plus className="mr-1 h-4 w-4" />
          Add starter
        </Button>
      )}
    </div>
  );
}

export const WithReorderList: Story = {
  render: () => <WithReorderListDemo />,
};
