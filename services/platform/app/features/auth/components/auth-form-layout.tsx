import { Heading } from '@tale/ui/heading';
import { Stack, VStack } from '@tale/ui/layout';
import { ReactNode } from 'react';

interface AuthFormLayoutProps {
  title: string;
  children: ReactNode;
}

export function AuthFormLayout({ title, children }: AuthFormLayoutProps) {
  return (
    <div className="relative">
      <VStack
        gap={8}
        className="relative mx-auto w-full max-w-[24.875rem] px-4"
      >
        <Stack gap={2} className="text-center">
          <Heading level={1} size="xl" className="tracking-[-0.12px]">
            {title}
          </Heading>
        </Stack>
        {children}
      </VStack>
    </div>
  );
}
