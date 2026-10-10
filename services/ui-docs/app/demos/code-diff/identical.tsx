import { CodeDiff } from '@tale/ui/code-diff';

const PROMPT = `Score this issue from 1 to 5.
Say why in one sentence.
`;

export default function CodeDiffIdentical() {
  return (
    <div className="grid w-full gap-3 sm:grid-cols-2">
      <div className="bg-card rounded-lg border p-3">
        <CodeDiff
          before={PROMPT}
          after={PROMPT}
          language="markdown"
          beforeLabel="v4"
          afterLabel="v5"
          aria-label="Score's prompt, v4 against v5"
        />
      </div>
      <div className="bg-card rounded-lg border p-3">
        <CodeDiff
          before={PROMPT}
          after={PROMPT}
          language="markdown"
          beforeLabel="v4"
          afterLabel="v5"
          emptyMessage="v5 keeps v4's prompt. Only the version's note is new."
          aria-label="Score's prompt, v4 against v5, with a message of your own"
        />
      </div>
    </div>
  );
}
