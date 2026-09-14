import { Button } from '@tale/ui/button';
import { ExternalLink } from 'lucide-react';

export default function ButtonAsChild() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Button asChild icon={ExternalLink}>
        <a
          href="https://github.com/tale-project/tale"
          target="_blank"
          rel="noreferrer"
        >
          Open the repository
        </a>
      </Button>
    </div>
  );
}
