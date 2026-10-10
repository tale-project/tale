import { CodeEditor } from '@tale/ui/code-editor';
import { Field } from '@tale/ui/field';
import { useState } from 'react';

export default function CodeEditorTemplates() {
  const [prompt, setPrompt] = useState(
    'Summarise the issues of {{ input.owner }}/{{ input.repo }}.\n\nRank them by **urgency** and keep {{ nodes.score.output.top }} at the top.',
  );
  const [body, setBody] = useState(
    '{\n  "to": "{{ input.email }}",\n  "subject": "Report for {{ nodes.triage.output.name }}"\n}',
  );
  const [each, setEach] = useState('{{ nodes.issues.output.items');
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <Field label="Prompt" htmlFor="demo-templates-prompt">
        <CodeEditor
          id="demo-templates-prompt"
          language="markdown"
          templates
          font="prose"
          value={prompt}
          onChange={setPrompt}
        />
      </Field>
      <Field label="Input" htmlFor="demo-templates-input">
        <CodeEditor
          id="demo-templates-input"
          language="json"
          templates
          value={body}
          onChange={setBody}
        />
      </Field>
      <Field
        label="For each"
        htmlFor="demo-templates-each"
        description="Its {{ has no closing }} yet."
      >
        <CodeEditor
          id="demo-templates-each"
          language="template"
          singleLine
          value={each}
          onChange={setEach}
        />
      </Field>
    </div>
  );
}
