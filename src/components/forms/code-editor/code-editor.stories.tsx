import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '../../overlays/responsive-dialog';
import { TooltipProvider } from '../../overlays/tooltip';
import { Button } from '../../primitives/button';
import { Field } from '../field';
import {
  CodeEditor,
  type CodeEditorDiagnostic,
  type CodeEditorProps,
} from './code-editor';
import type { CodeEditorProviders } from './providers';

const meta: Meta<typeof CodeEditor> = {
  title: 'Forms/CodeEditor',
  component: CodeEditor,
  tags: ['autodocs'],
  // A disabled reason shows in a tooltip, which needs a provider; the app
  // gets one from `AppShell`.
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
The one control for code, JSON, YAML, prompts and \`{{ js }}\` templates, on
CodeMirror 6 behind a lazy chunk. Highlights in the shared \`--code-*\` palette,
takes completion, hover and problems from the host, and never traps the
keyboard: Esc, then Tab leaves. See the guide on ui.tale.dev.
        `,
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof CodeEditor>;

/** A controlled editor, as a host form keeps one. */
function Controlled(props: Omit<CodeEditorProps, 'onChange'>) {
  const [value, setValue] = useState(props.value);
  return (
    <div className="max-w-xl">
      <CodeEditor {...props} value={value} onChange={setValue} />
    </div>
  );
}

const SAMPLES: Array<
  Pick<CodeEditorProps, 'language' | 'templates' | 'value'>
> = [
  {
    language: 'javascript',
    value:
      'const total = input.items.length;\nreturn { total, empty: total === 0 };',
  },
  { language: 'expression', value: 'nodes.score.output.total > 1000' },
  {
    language: 'json',
    value: '{\n  "to": "ada@example.com",\n  "draft": false\n}',
  },
  {
    language: 'yaml',
    value: 'name: Triage GitHub issues\nnodes:\n  - id: score\n    type: llm',
  },
  {
    language: 'markdown',
    value: '# Daily report\n\nSummarise the **open** issues.',
  },
  { language: 'template', value: 'Hello {{ input.name }}!' },
  { language: 'text', value: 'Plain text.' },
];

export const Languages: Story = {
  render: () => (
    <div className="flex max-w-xl flex-col gap-3">
      {SAMPLES.map((sample) => (
        <Controlled
          key={sample.language}
          aria-label={sample.language}
          {...sample}
          minRows={1}
        />
      ))}
    </div>
  ),
};

export const Templates: Story = {
  render: () => (
    <div className="flex max-w-xl flex-col gap-3">
      <Controlled
        aria-label="Text"
        language="text"
        templates
        value="Reply to {{ nodes.triage.output.name }} today."
      />
      <Controlled
        aria-label="JSON"
        language="json"
        templates
        value={'{\n  "to": "{{ input.email }}",\n  "n": 1\n}'}
      />
      <Controlled
        aria-label="YAML"
        language="yaml"
        templates
        value={'prompt: Rate {{ item.title }}\nwhen: "{{ input.ok }}"'}
      />
      <Controlled
        aria-label="Markdown"
        language="markdown"
        templates
        font="prose"
        value="Summarise **{{ nodes.report.output.count }}** issues."
      />
      <Controlled
        aria-label="Unterminated"
        language="template"
        singleLine
        value="{{ nodes.issues.output.items"
      />
    </div>
  ),
};

const PROBLEMS: CodeEditorDiagnostic[] = [
  {
    id: 'ref',
    severity: 'error',
    message: 'Reads "triag", and there is no node with that id.',
    code: 'REF_UNKNOWN_NODE',
    range: [18, 23],
    fixes: [
      {
        label: 'Read "triage"',
        changes: [{ range: [18, 23], insert: 'triage' }],
      },
    ],
  },
  {
    id: 'empty',
    severity: 'warning',
    message: 'A run started by hand may leave this empty.',
    range: [43, 54],
  },
  { id: 'todo', severity: 'info', message: 'Left for later.', range: [59, 63] },
];

export const Diagnostics: Story = {
  render: () => (
    <div className="flex max-w-xl flex-col gap-3">
      <Controlled
        aria-label="Ready"
        language="template"
        value={
          'Reply to {{ nodes.triag.output }} about {{ input.topic }}.\nTODO: sign off.'
        }
        diagnostics={PROBLEMS}
      />
      <Controlled
        aria-label="Checking"
        language="template"
        value={
          'Reply to {{ nodes.triag.output }} about {{ input.topic }}.\nTODO: sign off.'
        }
        diagnostics={PROBLEMS}
        diagnosticsStatus="checking"
      />
    </div>
  ),
};

const SHAPES: CodeEditorProviders = {
  completion: ({ path }) => {
    if (path === null) return null;
    if (path.length === 0) {
      return {
        items: [
          { label: 'nodes', kind: 'variable', valueType: 'object' },
          { label: 'input', kind: 'input', valueType: 'object' },
        ],
      };
    }
    if (path[0] === 'nodes' && path.length === 1) {
      return {
        items: [
          {
            label: 'score',
            kind: 'node',
            detail: 'Language model',
            section: 'Earlier nodes',
          },
          {
            label: 'open issues',
            kind: 'node',
            detail: 'Transform',
            section: 'Earlier nodes',
          },
        ],
      };
    }
    return {
      items: [
        {
          label: 'output',
          valueType: 'object',
          info: {
            type: '{ total: number }',
            description: 'What the node returns.',
          },
        },
      ],
    };
  },
  hover: ({ path }) =>
    path === null ? null : { title: path.join('.'), type: '{ total: number }' },
};

export const Completion: Story = {
  render: () => (
    <Controlled
      aria-label="Condition"
      language="expression"
      singleLine
      providers={SHAPES}
      value="nodes."
    />
  ),
};

export const Hover: Story = {
  render: () => (
    <Controlled
      aria-label="Code"
      language="javascript"
      providers={SHAPES}
      value="return nodes.score.output;"
    />
  ),
};

export const SingleLine: Story = {
  render: () => (
    <Controlled
      aria-label="Run when"
      language="expression"
      singleLine
      value="input.priority === 'high'"
      onSubmit={() => {}}
      submitLabel="Run"
    />
  ),
};

export const AutoGrow: Story = {
  render: () => (
    <Controlled
      aria-label="Code"
      language="javascript"
      minRows={2}
      maxRows={6}
      value={'// Add lines: the field grows to six, then scrolls.\nreturn 1;'}
    />
  ),
};

export const ReadOnly: Story = {
  render: () => (
    <Controlled
      aria-label="Source"
      language="yaml"
      templates
      readOnly
      lineNumbers
      size="md"
      value={
        'name: Triage\nnodes:\n  - id: score\n    prompt: Rate {{ item.title }}'
      }
    />
  ),
};

export const DisabledWithReason: Story = {
  render: () => (
    <Controlled
      aria-label="Code"
      language="javascript"
      disabled
      disabledReason="Only an author can change this."
      value="return input;"
    />
  ),
};

export const Expand: Story = {
  render: () => (
    <Controlled
      aria-label="Code"
      language="javascript"
      expandable
      lineNumbers
      value={'const a = 1;\nreturn a;'}
    />
  ),
};

export const InAFieldWithIssues: Story = {
  render: () => (
    <div className="max-w-xl">
      <Field
        label="Input"
        htmlFor="story-field-input"
        issues={[
          { id: 'to', severity: 'error', message: 'Reads a missing field.' },
        ]}
      >
        <CodeEditor
          id="story-field-input"
          language="json"
          templates
          value={'{"to": "{{ input.mail }}"}'}
          describeDiagnostics={false}
        />
      </Field>
    </div>
  ),
};

function DialogStory() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('nodes.score.output.total > 10');
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Edit condition
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogTitle>Edit condition</ResponsiveDialogTitle>
          <CodeEditor
            aria-label="Condition"
            language="expression"
            singleLine
            providers={SHAPES}
            value={value}
            onChange={setValue}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}

/** Escape closes the list, then arms leaving, then closes the dialog. */
export const InAResponsiveDialog: Story = {
  render: () => <DialogStory />,
};
