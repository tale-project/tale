import { SchemaTree, type SchemaTreeSchema } from '@tale/ui/schema-tree';

const INPUT: SchemaTreeSchema = {
  type: 'object',
  required: ['owner', 'repo'],
  properties: {
    owner: {
      type: 'string',
      description: 'The account that owns the repository.',
    },
    repo: { type: 'string' },
    limit: { type: 'integer', description: 'At most this many issues.' },
    state: { enum: ['open', 'closed'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          score: { type: ['number', 'null'] },
        },
      },
    },
  },
};

const TYPESCRIPT = `{
  owner: string;
  repo: string;
  limit?: number;
  state?: "open" | "closed";
  issues?: { title: string; score?: number | null }[];
}`;

export default function SchemaTreeBasic() {
  return (
    <div className="grid w-full max-w-2xl gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium">Compact</p>
        <SchemaTree
          schema={INPUT}
          density="compact"
          maxRows={3}
          tagOf={(path) =>
            path[0] === 'owner' ? 'from the trigger' : undefined
          }
          aria-label="Run input"
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium">Comfortable</p>
        <SchemaTree
          schema={INPUT}
          maybeEmpty={(path) => path[0] === 'issues'}
          typeScript={TYPESCRIPT}
          aria-label="Run input, in full"
        />
      </div>
    </div>
  );
}
