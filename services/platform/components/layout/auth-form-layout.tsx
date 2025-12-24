import { ReactNode } from 'react';

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
    <div className="relative mx-4 sm:mx-8">
      <div className="mx-auto w-full max-w-[24.875rem] flex flex-col gap-8 px-4 relative">
        <div className="text-center space-y-2">
          <h1 className="text-[20px] font-semibold tracking-[-0.12px]">
            {title}
          </h1>
        </div>
        {children}
      </div>
    </div>
  );
}
