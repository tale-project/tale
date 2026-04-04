import type { Meta, StoryObj } from '@storybook/react';
import { Languages, Loader2 } from 'lucide-react';
import { useState } from 'react';

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
