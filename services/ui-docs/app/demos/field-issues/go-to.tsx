import { EditorActions } from '@tale/ui/editor/editor-actions';
import type { EditorController } from '@tale/ui/editor/types';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import {
  IssueFocusProvider,
  useIssueFocusTarget,
  useRequestIssueFocus,
} from '@tale/ui/issue-focus';
import { IssueList, type IssueItem } from '@tale/ui/issue-list';
import { Textarea } from '@tale/ui/textarea';
import { useRef, useState } from 'react';

const SAVED = {
  name: 'Reply to customers',
  prompt: 'Reply to {{ nodes.triage.output }}',
};
const TYPO = 'nodes.nope';

/** The demo's own check: one rule, so the example stays readable. */
function check(prompt: string) {
  const at = prompt.indexOf(TYPO);
  return at === -1 ? null : ([at, at + TYPO.length] as const);
}

function Fields({
  name,
  prompt,
  onName,
  onPrompt,
  range,
}: {
  name: string;
  prompt: string;
  onName: (value: string) => void;
  onPrompt: (value: string) => void;
  range: readonly [number, number] | null;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  useIssueFocusTarget('/name', nameRef);
  useIssueFocusTarget('/nodes/0/prompt', promptRef);
  return (
    <div className="flex flex-col gap-4">
      <Field label="Name" htmlFor="demo-issue-name">
        <Input
          ref={nameRef}
          id="demo-issue-name"
          value={name}
          onChange={(event) => onName(event.target.value)}
        />
      </Field>
      <Field
        label="Prompt"
        htmlFor="demo-issue-prompt"
        description="What the agent is asked to do."
        issues={
          range === null
            ? []
            : [
                {
                  id: 'unknown-node',
                  severity: 'error',
                  message: 'Reads "nope", and there is no node with that id.',
                },
              ]
        }
      >
        <Textarea
          ref={promptRef}
          id="demo-issue-prompt"
          value={prompt}
          onChange={(event) => onPrompt(event.target.value)}
          className="min-h-20"
        />
      </Field>
    </div>
  );
}

function Problems({ range }: { range: readonly [number, number] | null }) {
  const requestFocus = useRequestIssueFocus();
  const issues: IssueItem[] =
    range === null
      ? []
      : [
          {
            id: 'unknown-node',
            severity: 'error',
            title: 'Reads a node that does not exist',
            location: 'Prompt',
            fix: 'Read "triage", the node this automation has.',
          },
        ];
  return (
    <div className="bg-background rounded-lg border">
      <IssueList
        issues={issues}
        density="compact"
        onActivate={() => {
          if (range !== null) requestFocus('/nodes/0/prompt', range);
        }}
      />
    </div>
  );
}

export default function FieldIssuesGoTo() {
  const [name, setName] = useState(SAVED.name);
  const [prompt, setPrompt] = useState(`Reply to {{ ${TYPO}.output }}`);
  const range = check(prompt);
  const errors = range === null ? 0 : 1;
  const controller: EditorController = {
    isDirty: name !== SAVED.name || prompt !== SAVED.prompt,
    isSaving: false,
    isValid: errors === 0,
    invalidReason: errors === 0 ? undefined : 'Fix 1 error to save',
    isLoading: false,
    dirtyKeys: new Set(),
    save: async () => {},
    reset: () => {
      setName(SAVED.name);
      setPrompt(SAVED.prompt);
    },
  };
  return (
    <IssueFocusProvider>
      <div className="flex w-full max-w-md flex-col gap-4">
        <Problems range={range} />
        <Fields
          name={name}
          prompt={prompt}
          onName={setName}
          onPrompt={setPrompt}
          range={range}
        />
        <EditorActions controller={controller} className="justify-end" />
      </div>
    </IssueFocusProvider>
  );
}
