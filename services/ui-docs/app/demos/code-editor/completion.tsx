import { CodeEditor } from '@tale/ui/code-editor';
import type {
  CodeCompletionItem,
  CodeEditorProviders,
} from '@tale/ui/code-editor/providers';
import { Field } from '@tale/ui/field';
import { useState } from 'react';

/** What each name holds, in the demo: a tiny made-up automation. */
interface Shape {
  type: string;
  description?: string;
  fields?: Record<string, Shape>;
}

const DATA: Record<string, Shape> = {
  input: {
    type: '{ owner: string; repo: string }',
    description: 'What the run started with.',
    fields: {
      owner: {
        type: 'string',
        description: 'The account that owns the repository.',
      },
      repo: { type: 'string' },
    },
  },
  nodes: {
    type: '{ issues: …; score: … }',
    fields: {
      issues: {
        type: '{ output: { items: object[] } }',
        fields: {
          output: {
            type: '{ items: object[] }',
            fields: {
              items: {
                type: 'object[]',
                description: 'Open issues, newest first.',
              },
            },
          },
        },
      },
      score: {
        type: '{ output: { total: number } }',
        fields: {
          output: {
            type: '{ total: number }',
            fields: {
              total: {
                type: 'number',
                description: 'How urgent the issues are, 0 to 100.',
              },
            },
          },
        },
      },
    },
  },
};

function at(
  path: readonly (string | number)[],
): Record<string, Shape> | undefined {
  let level: Record<string, Shape> | undefined = DATA;
  for (const segment of path) {
    level = level?.[String(segment)]?.fields;
  }
  return level;
}

function valueType(type: string): CodeCompletionItem['valueType'] {
  if (type === 'string') return 'string';
  if (type === 'number') return 'number';
  if (type.endsWith('[]')) return 'array';
  return 'object';
}

const PROVIDERS: CodeEditorProviders = {
  completion: ({ path }) => {
    if (path === null) return null;
    const fields = at(path);
    if (fields === undefined) return null;
    return {
      items: Object.entries(fields).map(([label, shape]) => ({
        label,
        kind: path.length === 1 && path[0] === 'nodes' ? 'node' : 'property',
        valueType: valueType(shape.type),
        detail: shape.type,
        info: { type: shape.type, description: shape.description },
      })),
    };
  },
  hover: ({ path }) => {
    if (path === null || path.length === 0) return null;
    const parent = at(path.slice(0, -1));
    const shape = parent?.[String(path.at(-1))];
    return shape === undefined
      ? null
      : {
          title: path.join('.'),
          type: shape.type,
          description: shape.description,
        };
  },
};

export default function CodeEditorCompletion() {
  const [code, setCode] = useState(
    'const total = nodes.score.output.total;\nreturn { owner: input.owner, total };',
  );
  return (
    <div className="w-full max-w-xl">
      <Field
        label="Code"
        htmlFor="demo-completion-code"
        description="Type nodes. or input. — or press Ctrl+Space."
      >
        <CodeEditor
          id="demo-completion-code"
          language="javascript"
          value={code}
          onChange={setCode}
          providers={PROVIDERS}
          minRows={4}
        />
      </Field>
    </div>
  );
}
