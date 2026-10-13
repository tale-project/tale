import { cn } from '@tale/ui/cn';
import { Heading } from '@tale/ui/heading';
import { Stack, VStack } from '@tale/ui/layout';
import type { ReactNode } from 'react';

interface AuthFormLayoutProps {
  title: string;
  /** A picture above the title, such as who is connecting to what. */
  mark?: ReactNode;
  children: ReactNode;
}

export function AuthFormLayout({ title, mark, children }: AuthFormLayoutProps) {
  return (
    <div className="relative">
      <VStack
        gap={8}
        className="relative mx-auto w-full max-w-[24.875rem] px-4"
      >
        <Stack gap={mark === undefined ? 2 : 6} className="text-center">
          {mark}
          <Heading
            level={1}
            size="xl"
            // A title that carries someone else's words — an app's own name —
            // must break inside a column however long it is.
            className={cn(
              'tracking-[-0.12px]',
              mark !== undefined && 'wrap-anywhere',
            )}
          >
            {title}
          </Heading>
        </Stack>
        {children}
      </VStack>
    </div>
  );
}
