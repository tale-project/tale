import { ReactNode } from 'react';
import { Stack, VStack } from '@/components/ui/layout/layout';

interface AuthFormLayoutProps {
  /**
   * The title displayed at the top of the form.
   */
  title: string;
  children: ReactNode;
}

/**
 * Shared layout wrapper for auth forms (login, signup).
 * Provides consistent centering, max-width, and title styling.
 */
export function AuthFormLayout({ title, children }: AuthFormLayoutProps) {
  return (
    <div className="relative">
      <VStack
        gap={8}
        className="mx-auto w-full max-w-[24.875rem] px-4 relative"
      >
        <Stack gap={2} className="text-center">
          <h1 className="text-xl font-semibold tracking-[-0.12px]">{title}</h1>
        </Stack>
        {children}
      </VStack>
    </div>
  );
}
