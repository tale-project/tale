import { ReactNode } from 'react';

import { Stack, VStack } from '@/app/components/ui/layout/layout';

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
          <h1 className="text-xl font-semibold tracking-[-0.12px]">{title}</h1>
        </Stack>
        {children}
      </VStack>
    </div>
  );
}
