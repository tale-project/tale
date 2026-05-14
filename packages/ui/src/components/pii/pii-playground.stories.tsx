import type { Meta, StoryObj } from '@storybook/react';
import i18n from 'i18next';
import { useEffect, type ReactNode } from 'react';

import { PiiPlayground } from './pii-playground';

/**
 * Decorator that flips i18next's active locale for the duration of a
 * story. Re-uses the same global i18n instance Storybook's preview
 * bootstraps with `@tale/ui`'s message bundles — no per-story stub
 * translators needed.
 */
function WithLocale({
  locale,
  children,
}: {
  locale: 'en' | 'de' | 'fr';
  children: ReactNode;
}) {
  useEffect(() => {
    if (i18n.language === locale) return;
    void i18n.changeLanguage(locale);
  }, [locale]);
  return <>{children}</>;
}

const meta: Meta<typeof PiiPlayground> = {
  title: 'PII/Playground',
  component: PiiPlayground,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
End-to-end demonstration of the PII tokenize → AI → detokenize round-trip.

## How it works

1. **Input** — the user types or pastes any text. Detection runs live on every keystroke.
2. **Detected** — every PII span is highlighted (yellow). Hover any highlight to see the type label (translated brief, e.g. "Email", "Phone", "IBAN").
3. **Tokenized** — what the platform would actually send to an upstream AI: every PII span replaced with a stable indexed token like \`[EMAIL_1]\`. Same value seen twice keeps the same index.
4. **AI response (mock)** — editable. Try moving tokens around, repeating them, or wrapping them in markdown — detokenize tolerates all of that.
5. **Restored** — the response after \`detokenize\` runs. Green highlights show exactly which words came back from the round-trip.

## i18n wiring

The component pulls its strings from the \`piiPlayground\` and \`piiTypes\` namespaces shipped by \`@tale/ui\`. Apps just mount the shared \`<I18nProvider>\` at the root — no per-component translator props.

## Library API

\`\`\`ts
import { createTokenizer } from '@tale/pii';

const tokenizer = createTokenizer({ mode: 'mask', patterns: { email: true, ... } });
const { text, mapping } = tokenizer.tokenize(userInput);
// send \`text\` to the LLM, then:
const restored = tokenizer.detokenize(llmResponse, mapping);
\`\`\`

## Accessibility

- Each highlight is a real \`<mark>\` with \`aria-label="<Type>: <value>"\`.
- Tooltip is keyboard-reachable via Tab.
- The rounded background ring is a colour-independent affordance.
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof PiiPlayground>;

export const Default: Story = {
  args: {
    detectionLocales: '*',
  },
  render: (args) => (
    <WithLocale locale="en">
      <div className="mx-auto max-w-3xl p-8">
        <PiiPlayground {...args} />
      </div>
    </WithLocale>
  ),
};

export const NoPII: Story = {
  args: {
    initialInput:
      'The conference room was packed with engineers ready to demo.',
    detectionLocales: '*',
  },
  render: (args) => (
    <WithLocale locale="en">
      <div className="mx-auto max-w-3xl p-8">
        <PiiPlayground {...args} />
      </div>
    </WithLocale>
  ),
};

export const German: Story = {
  args: {
    detectionLocales: ['de'],
    initialInput: [
      'Schick das Paket an Müller in der Bahnhofstraße 12, 80331 München.',
      'Telefon: +49 30 12345678.',
      'E-Mail: max.mueller@example.de.',
    ].join(' '),
  },
  render: (args) => (
    <WithLocale locale="de">
      <div className="mx-auto max-w-3xl p-8">
        <PiiPlayground {...args} />
      </div>
    </WithLocale>
  ),
};

export const French: Story = {
  args: {
    detectionLocales: ['fr'],
    initialInput: [
      'Veuillez expédier à Marie Dupont, Rue de la Paix 5, 75002 Paris.',
      'Téléphone : +33 1 23 45 67 89.',
      'Courriel : marie.dupont@example.fr.',
    ].join(' '),
  },
  render: (args) => (
    <WithLocale locale="fr">
      <div className="mx-auto max-w-3xl p-8">
        <PiiPlayground {...args} />
      </div>
    </WithLocale>
  ),
};

export const RepeatedReferences: Story = {
  args: {
    detectionLocales: '*',
    initialInput:
      'Send a copy to alice@example.com. Cc alice@example.com as well, thanks.',
    mockAi: (prompt) =>
      `Confirmed — both copies will go to [EMAIL_1]. Original prompt for reference:\n\n${prompt}`,
  },
  render: (args) => (
    <WithLocale locale="en">
      <div className="mx-auto max-w-3xl p-8">
        <PiiPlayground {...args} />
      </div>
    </WithLocale>
  ),
};

export const ConversationalResponse: Story = {
  args: {
    detectionLocales: '*',
    initialInput:
      'I am Alice at alice@example.com. Call me at +1 415 555 0142 about my IBAN DE89370400440532013000.',
    mockAi: () =>
      [
        "Of course — I'll follow up about your IBAN **[IBAN_1]**.",
        '',
        'I have noted:',
        '- Your email: [EMAIL_1]',
        '- Your number: [PHONE_1]',
        '',
        'I will call [PHONE_1] tomorrow morning.',
      ].join('\n'),
  },
  render: (args) => (
    <WithLocale locale="en">
      <div className="mx-auto max-w-3xl p-8">
        <PiiPlayground {...args} />
      </div>
    </WithLocale>
  ),
};
