import { CodeEditor, type CodeLanguage } from '@tale/ui/code-editor';
import { Select } from '@tale/ui/select';
import { useState } from 'react';

const SAMPLES: Record<CodeLanguage, string> = {
  javascript: `const total = input.items.length;
return { total, empty: total === 0 };`,
  expression: 'nodes.score.output.total > 1000',
  json: `{
  "to": "ada@example.com",
  "subject": "Weekly report",
  "draft": false
}`,
  yaml: `name: Triage GitHub issues
nodes:
  - id: open_issues
    type: transform`,
  markdown: `# Daily report

Summarise the **open** issues in a short list.`,
  template:
    'Hello {{ input.name }}, you have {{ nodes.inbox.output.count }} new messages.',
  text: 'Plain text, with no highlighting.',
};

const LABELS: Record<CodeLanguage, string> = {
  javascript: 'JavaScript (a script)',
  expression: 'Expression (a condition)',
  json: 'JSON',
  yaml: 'YAML',
  markdown: 'Markdown',
  template: 'Text with templates',
  text: 'Plain text',
};

const ORDER: CodeLanguage[] = [
  'javascript',
  'expression',
  'json',
  'yaml',
  'markdown',
  'template',
  'text',
];

export default function CodeEditorLanguages() {
  const [language, setLanguage] = useState<CodeLanguage>('javascript');
  const [texts, setTexts] = useState(SAMPLES);
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <Select
        label="Language"
        value={language}
        onValueChange={(next) => {
          const found = ORDER.find((option) => option === next);
          if (found !== undefined) setLanguage(found);
        }}
        options={ORDER.map((value) => ({ value, label: LABELS[value] }))}
      />
      <CodeEditor
        key={language}
        aria-label={`${LABELS[language]} sample`}
        language={language}
        value={texts[language]}
        onChange={(value) => setTexts({ ...texts, [language]: value })}
        singleLine={language === 'expression'}
        font={language === 'markdown' ? 'prose' : 'mono'}
      />
    </div>
  );
}
