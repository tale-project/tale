import { ValueTree } from '@tale/ui/value-tree';
import { useState } from 'react';

const ISSUE = {
  title: 'Login fails on Safari',
  number: 4821,
  open: true,
  closedAt: null,
  labels: ['bug', 'ui', 'safari'],
  author: { login: 'ada', name: 'Ada Lovelace', id: 7 },
  comments: [
    { author: 'grace', body: 'I can reproduce it on Safari 18.' },
    { author: 'ada', body: 'The cookie is set without SameSite.' },
  ],
  body: 'Steps to reproduce: open the login page in Safari, enter a valid email and password, and press Sign in. The page reloads and asks for the password again. '.repeat(
    3,
  ),
};

export default function ValueTreeBasic() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="flex w-full max-w-xl flex-col gap-2">
      <div className="bg-card rounded-lg border p-2">
        <ValueTree
          value={ISSUE}
          aria-label="Issue"
          selectedPointer={selected}
          onSelectPointer={setSelected}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        Selected: <code className="font-mono">{selected ?? 'nothing yet'}</code>
      </p>
    </div>
  );
}
