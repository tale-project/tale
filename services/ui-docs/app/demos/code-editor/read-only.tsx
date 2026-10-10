import { CodeEditor } from '@tale/ui/code-editor';
import { CodeBlock } from '@tale/ui/markdown/code-block';

const SOURCE = `name: Triage GitHub issues
nodes:
  - id: score
    type: llm
    prompt: Rate {{ item.title }} from 0 to 100
    when: "{{ nodes.issues.output.items.length > 0 }}"`;

export default function CodeEditorReadOnly() {
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <CodeEditor
        aria-label="Automation source"
        language="yaml"
        templates
        readOnly
        lineNumbers
        size="md"
        value={SOURCE}
      />
      <CodeBlock
        code={SOURCE}
        language="yaml-template"
        filename="automation.yml"
      />
    </div>
  );
}
