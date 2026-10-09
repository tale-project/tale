import { CodeEditor, type CodeEditorDiagnostic } from '@tale/ui/code-editor';
import { Field } from '@tale/ui/field';
import { Switch } from '@tale/ui/switch';
import { useMemo, useState } from 'react';

const NODES = ['triage', 'score', 'report'];

/** The nearest known node name, for a "did you mean" fix. */
function closest(name: string): string | undefined {
  return NODES.find((node) => node[0] === name[0]) ?? NODES[0];
}

/**
 * The demo's own checker: a node that does not exist is an error with a
 * fix, a run input may be empty, and a TODO is a note.
 */
function check(text: string): CodeEditorDiagnostic[] {
  const found: CodeEditorDiagnostic[] = [];
  for (const match of text.matchAll(/nodes\.(\w+)/g)) {
    const name = match[1];
    if (NODES.includes(name)) continue;
    const from = (match.index ?? 0) + 'nodes.'.length;
    const suggestion = closest(name);
    found.push({
      id: `node-${from}`,
      severity: 'error',
      message: `Reads "${name}", and there is no node with that id.`,
      code: 'REF_UNKNOWN_NODE',
      range: [from, from + name.length],
      fixes:
        suggestion === undefined
          ? []
          : [
              {
                label: `Read "${suggestion}"`,
                changes: [
                  { range: [from, from + name.length], insert: suggestion },
                ],
              },
            ],
    });
  }
  for (const match of text.matchAll(/input\.\w+/g)) {
    const from = match.index ?? 0;
    found.push({
      id: `input-${from}`,
      severity: 'warning',
      message: 'A run started by hand may leave this empty.',
      range: [from, from + match[0].length],
    });
  }
  for (const match of text.matchAll(/TODO/g)) {
    const from = match.index ?? 0;
    found.push({
      id: `todo-${from}`,
      severity: 'info',
      message: 'Left for later.',
      range: [from, from + 4],
    });
  }
  return found;
}

export default function CodeEditorDiagnostics() {
  const [text, setText] = useState(
    'Reply to {{ nodes.triag.output.name }} about {{ input.topic }}.\nTODO: sign off.',
  );
  const [checking, setChecking] = useState(false);
  // A real host checks on a server and passes the text it checked.
  const [checked, setChecked] = useState(text);
  const diagnostics = useMemo(() => check(checked), [checked]);
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <Switch
        label="Show the check as running"
        checked={checking}
        onCheckedChange={(next) => {
          setChecking(next);
          if (!next) setChecked(text);
        }}
      />
      <Field label="Prompt" htmlFor="demo-diagnostics-prompt">
        <CodeEditor
          id="demo-diagnostics-prompt"
          language="template"
          value={text}
          onChange={(next) => {
            setText(next);
            if (!checking) setChecked(next);
          }}
          diagnostics={diagnostics}
          diagnosticsFor={checked}
          diagnosticsStatus={checking ? 'checking' : 'ready'}
        />
      </Field>
    </div>
  );
}
