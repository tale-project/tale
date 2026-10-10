import { CodeEditor } from '@tale/ui/code-editor';
import { Field } from '@tale/ui/field';
import { useState } from 'react';

const START = `// Count the open issues per label.
const counts = {};
for (const issue of input.issues) {
  const label = issue.labels[0] ?? 'none';
  counts[label] = (counts[label] ?? 0) + 1;
}
return counts;`;

export default function CodeEditorBasic() {
  const [code, setCode] = useState(START);
  return (
    <div className="w-full max-w-xl">
      <Field
        label="Code"
        htmlFor="demo-code-editor-basic"
        description="Runs once per run. What it returns is the node's output."
      >
        <CodeEditor
          id="demo-code-editor-basic"
          language="javascript"
          value={code}
          onChange={setCode}
          lineNumbers
          minRows={6}
          maxRows={14}
          expandable
        />
      </Field>
    </div>
  );
}
