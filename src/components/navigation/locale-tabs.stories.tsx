import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { LocaleTabs } from './locale-tabs';

const meta: Meta<typeof LocaleTabs> = {
  title: 'Navigation/LocaleTabs',
  component: LocaleTabs,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Tabs for editing one piece of text per language. The default locale comes first;
a translation tab without text shows an "untranslated" pill, and each locale's
editor renders inside its own panel, kept mounted across tab switches.

## Usage
\`\`\`tsx
import { LocaleTabs } from '@tale/ui/locale-tabs';

<LocaleTabs
  defaultLocale="en"
  editingLocale={editingLocale}
  onEditingLocaleChange={setEditingLocale}
  hasTranslation={(locale) => texts[locale] !== ''}
  renderPanel={(locale) => <Textarea aria-label={\`Text (\${locale})\`} />}
/>
\`\`\`
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof LocaleTabs>;

function Editor({ withAutoTranslate }: { withAutoTranslate?: boolean }) {
  const [editingLocale, setEditingLocale] = useState('en');
  const [texts, setTexts] = useState<Record<string, string>>({
    en: 'Do not paste client names into chat.',
    de: '',
    fr: '',
  });
  return (
    <div className="w-[28rem]">
      <LocaleTabs
        defaultLocale="en"
        editingLocale={editingLocale}
        onEditingLocaleChange={setEditingLocale}
        hasTranslation={(locale) => (texts[locale] ?? '') !== ''}
        listAriaLabel="Notice languages"
        {...(withAutoTranslate ? { onAutoTranslate: () => {} } : {})}
        renderPanel={(locale) => (
          <textarea
            aria-label={`Notice text (${locale})`}
            className="border-border rounded-md border p-2 text-sm"
            value={texts[locale] ?? ''}
            onChange={(event) =>
              setTexts((current) => ({
                ...current,
                [locale]: event.target.value,
              }))
            }
          />
        )}
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <Editor />,
};

export const WithAutoTranslate: Story = {
  render: () => <Editor withAutoTranslate />,
};
