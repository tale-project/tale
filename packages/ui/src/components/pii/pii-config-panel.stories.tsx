import type { Meta, StoryObj } from '@storybook/react';
import { BUILT_IN_PATTERN_NAMES } from '@tale/pii';
import i18n from 'i18next';
import { useEffect, useState, type ReactNode } from 'react';

import {
  PiiConfigPanel,
  type PiiConfigPanelProps,
  type PiiConfigPanelValue,
} from './pii-config-panel';

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

/**
 * Wrapper that gives each story its own controlled state. The platform
 * passes `value` / `onChange` wired to Convex — here we just keep it
 * local so the panel actually reacts to edits in Storybook.
 */
function StatefulPanel({
  initialValue,
  ...rest
}: Omit<PiiConfigPanelProps, 'value' | 'onChange'> & {
  initialValue: PiiConfigPanelValue;
}) {
  const [value, setValue] = useState<PiiConfigPanelValue>(initialValue);
  return <PiiConfigPanel value={value} onChange={setValue} {...rest} />;
}

const ALL_BUILT_INS = [...BUILT_IN_PATTERN_NAMES];

const DEFAULT_VALUE: PiiConfigPanelValue = {
  mode: 'tokenize',
  enabledPatterns: ALL_BUILT_INS,
  customPatterns: [],
};

const meta: Meta<typeof PiiConfigPanel> = {
  title: 'PII/Config Panel',
  component: PiiConfigPanel,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
The canonical PII configuration surface — settings form + live preview in a single component.

## Sections

1. **Mode** — choose how the policy reacts when PII is detected: \`tokenize\` (default, round-trippable), \`mask\` (one-way replacement), or \`block\` (reject the message).
2. **Patterns** — toggle each of the ten built-in detectors. Translated labels come from \`@tale/ui\`'s \`piiTypes\` namespace, so the row reads "Email" / "E-Mail" / "Courriel" depending on the active locale.
3. **Custom patterns** — admin-supplied name + regex + replacement triples. The Save button refuses syntactically broken expressions client-side; the backend re-validates with \`safe-regex2\` for ReDoS shapes.
4. **Live preview** — drop in a sentence; detection runs on every keystroke. The preview honours the **active** configuration, so flipping a pattern off makes its detections disappear from the highlights and adding a custom regex makes its matches show up immediately.

## Usage

\`\`\`tsx
import { PiiConfigPanel, type PiiConfigPanelValue } from '@tale/ui/pii-config-panel';

const [value, setValue] = useState<PiiConfigPanelValue>(initialValue);

<PiiConfigPanel
  value={value}
  onChange={(next) => {
    setValue(next);
    void persistConfig(next);
  }}
  disabled={!canManage}
/>
\`\`\`

## Highlight palette

- **Yellow** — original PII spans detected by the active config.
- **Blue** — indexed tokens (\`[EMAIL_1]\`) that would be sent to the upstream model.
- **Green** — original details restored on the way back from the AI.

Every highlight is a real \`<mark>\` with an icon for its type, an \`aria-label\` carrying "<Type>: <value>", and a hover tooltip showing both lines.
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof PiiConfigPanel>;

const Frame = ({ children }: { children: ReactNode }) => (
  <div className="mx-auto max-w-3xl p-8">{children}</div>
);

export const Default: Story = {
  render: () => (
    <WithLocale locale="en">
      <Frame>
        <StatefulPanel initialValue={DEFAULT_VALUE} />
      </Frame>
    </WithLocale>
  ),
};

export const MaskMode: Story = {
  render: () => (
    <WithLocale locale="en">
      <Frame>
        <StatefulPanel initialValue={{ ...DEFAULT_VALUE, mode: 'mask' }} />
      </Frame>
    </WithLocale>
  ),
};

export const BlockMode: Story = {
  render: () => (
    <WithLocale locale="en">
      <Frame>
        <StatefulPanel initialValue={{ ...DEFAULT_VALUE, mode: 'block' }} />
      </Frame>
    </WithLocale>
  ),
};

export const NoPatternsEnabled: Story = {
  render: () => (
    <WithLocale locale="en">
      <Frame>
        <StatefulPanel
          initialValue={{ ...DEFAULT_VALUE, enabledPatterns: [] }}
        />
      </Frame>
    </WithLocale>
  ),
};

export const NoPIIInInput: Story = {
  render: () => (
    <WithLocale locale="en">
      <Frame>
        <StatefulPanel
          initialValue={DEFAULT_VALUE}
          initialPreviewInput="The conference room was packed with engineers ready to demo."
        />
      </Frame>
    </WithLocale>
  ),
};

export const WithCustomPatterns: Story = {
  render: () => (
    <WithLocale locale="en">
      <Frame>
        <StatefulPanel
          initialValue={{
            ...DEFAULT_VALUE,
            customPatterns: [
              {
                name: 'Employee ID',
                regex: 'EMP-\\d{6}',
                replacement: '[EMPLOYEE_ID]',
              },
              {
                name: 'Project code',
                regex: '\\b[A-Z]{3}-\\d{4}\\b',
                replacement: '[PROJECT]',
              },
            ],
          }}
          initialPreviewInput="Ticket from EMP-123456 about project NYC-2025 needs review."
        />
      </Frame>
    </WithLocale>
  ),
};

export const Disabled: Story = {
  render: () => (
    <WithLocale locale="en">
      <Frame>
        <StatefulPanel initialValue={DEFAULT_VALUE} disabled />
      </Frame>
    </WithLocale>
  ),
};

export const German: Story = {
  render: () => (
    <WithLocale locale="de">
      <Frame>
        <StatefulPanel
          initialValue={DEFAULT_VALUE}
          detectionLocales={['de']}
          initialPreviewInput={[
            'Schick das Paket an Müller in der Bahnhofstraße 12, 80331 München.',
            'Telefon: +49 30 12345678.',
            'E-Mail: max.mueller@example.de.',
          ].join(' ')}
        />
      </Frame>
    </WithLocale>
  ),
};

export const French: Story = {
  render: () => (
    <WithLocale locale="fr">
      <Frame>
        <StatefulPanel
          initialValue={DEFAULT_VALUE}
          detectionLocales={['fr']}
          initialPreviewInput={[
            'Veuillez expédier à Marie Dupont, Rue de la Paix 5, 75002 Paris.',
            'Téléphone : +33 1 23 45 67 89.',
            'Courriel : marie.dupont@example.fr.',
          ].join(' ')}
        />
      </Frame>
    </WithLocale>
  ),
};

export const RepeatedReferences: Story = {
  render: () => (
    <WithLocale locale="en">
      <Frame>
        <StatefulPanel
          initialValue={DEFAULT_VALUE}
          initialPreviewInput="Send a copy to alice@example.com. Cc alice@example.com as well, thanks."
          mockAi={(prompt) =>
            `Confirmed — both copies will go to [EMAIL_1]. Original prompt for reference:\n\n${prompt}`
          }
        />
      </Frame>
    </WithLocale>
  ),
};

export const ConversationalResponse: Story = {
  render: () => (
    <WithLocale locale="en">
      <Frame>
        <StatefulPanel
          initialValue={DEFAULT_VALUE}
          initialPreviewInput="I am Alice at alice@example.com. Call me at +1 415 555 0142 about my IBAN DE89370400440532013000."
          mockAi={() =>
            [
              "Of course — I'll follow up about your IBAN **[IBAN_1]**.",
              '',
              'I have noted:',
              '- Your email: [EMAIL_1]',
              '- Your number: [PHONE_1]',
              '',
              'I will call [PHONE_1] tomorrow morning.',
            ].join('\n')
          }
        />
      </Frame>
    </WithLocale>
  ),
};
