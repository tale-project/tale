import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import type { MentionOption } from './mention-options';
import { MentionTextarea } from './mention-textarea';

const KINDS = ['user', 'agent'] as const;
type Kind = (typeof KINDS)[number];

const OPTIONS: MentionOption<Kind>[] = [
  {
    kind: 'user',
    id: 'u-ada',
    name: 'Ada Lovelace',
    caption: 'ada@example.com',
    keywords: ['ada', 'ada@example.com'],
  },
  {
    kind: 'user',
    id: 'u-noah',
    name: 'Noah Keller',
    caption: 'noah@example.com',
    keywords: ['noah', 'noah@example.com'],
  },
  {
    kind: 'agent',
    id: 'a-opus',
    name: 'My Opus Agent #3',
    caption: '@my-opus-agent-3 · Agent',
    keywords: ['my-opus-agent-3'],
  },
];

const NAMES = new Map(
  OPTIONS.map((option) => [`${option.kind}:${option.id}`, option.name]),
);

function Field({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex w-96 flex-col gap-3">
      <MentionTextarea
        label="Comment"
        rows={4}
        placement="below"
        kinds={KINDS}
        options={OPTIONS}
        nameOf={(ref) => NAMES.get(`${ref.kind}:${ref.id}`)}
        value={value}
        onValueChange={setValue}
      />
      <pre className="text-muted-foreground text-xs break-all whitespace-pre-wrap">
        {value}
      </pre>
    </div>
  );
}

const meta: Meta<typeof Field> = {
  title: 'Forms/MentionTextarea',
  component: Field,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A textarea that mentions people: typing \`@\` opens a picker, and a picked mention reads \`@\` and the name, tinted. The value the caller holds is the stored form, each mention a token (\`[@Ada Lovelace](mention:user/u-ada)\`), so it saves and restores as a plain string; the field shows each token by its current name (\`nameOf\`). The text under the field in these stories is that stored value.

## Usage
\`\`\`tsx
import { MentionTextarea } from '@tale/ui/mentions/mention-textarea';

<MentionTextarea
  label="Comment"
  kinds={['user', 'agent']}
  options={options}
  nameOf={(ref) => directory.get(ref)?.name}
  value={draft}
  onValueChange={setDraft}
/>
\`\`\`

## Behaviour
- A mention is one piece: Backspace at its end or Delete at its start removes all of it, and undo brings it back
- Typing inside a name makes it plain text; a selection that cuts into one grows to take it whole
- Copy and paste between mention fields keep mentions; a mention never forms inside code
- A name with spaces is searchable across them ("@my opus")

## Accessibility
- The native textarea stays: IME, spellcheck, selection and screen readers work as in any field
- The picker is a combobox listbox (Up/Down, Enter or Tab picks, Escape closes; a modified Enter is the caller's)
- Each inserted or removed mention is announced in a polite live region
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Field>;

export const Empty: Story = { args: { initial: '' } };

export const WithMentions: Story = {
  args: {
    initial:
      'Hi [@Ada Lovelace](mention:user/u-ada), please hand the numbers to [@Old Name](mention:agent/a-opus) once they are in.',
  },
  parameters: {
    docs: {
      description: {
        story:
          'A stored text: each token shows the current name of whoever it names, whatever name it was saved with.',
      },
    },
  },
};
