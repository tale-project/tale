import { Suspense, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

interface SuspenseLoaderProps {
  children: ReactNode;
}

export function SuspenseLoader({ children }: SuspenseLoaderProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[200px] p-8">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
