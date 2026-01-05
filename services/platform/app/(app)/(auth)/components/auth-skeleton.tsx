import { Skeleton } from '@/components/ui/skeleton';
import { Stack, HStack } from '@/components/ui/layout';
import { AuthFormLayout } from './auth-form-layout';

interface AuthInputSkeletonProps {
  /** Whether to show password requirements list */
  showRequirements?: boolean;
}

function AuthInputSkeleton({ showRequirements }: AuthInputSkeletonProps) {
  return (
    <Stack gap={2}>
      {/* Label */}
      <Skeleton className="h-4 w-16" />
      {/* Input field */}
      <Skeleton className="h-10 w-full rounded-md" />
      {/* Password requirements (only for signup) */}
      {showRequirements && (
        <Stack gap={1} className="mt-1">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-3 w-52" />
        </Stack>
      )}
    </Stack>
  );
}

interface AuthFormSkeletonProps {
  /** Title shown at the top */
  title: string;
  /** Whether to show password requirements (signup form) */
  showPasswordRequirements?: boolean;
  /** Whether to show Microsoft OAuth button */
  showMicrosoftButton?: boolean;
}

/**
 * Skeleton for authentication forms (login/signup).
 * Matches the exact structure of LogInForm and SignUpForm components.
 *
 * ## Example:
 * ```tsx
 * <AuthFormSkeleton
 *   title="Log in"
 *   showMicrosoftButton
 * />
 * ```
 */
export function AuthFormSkeleton({
  title,
  showPasswordRequirements = false,
  showMicrosoftButton = false,
}: AuthFormSkeletonProps) {
  return (
    <AuthFormLayout title={title}>
      <Stack gap={8}>
        <Stack gap={5}>
          {/* Email Field */}
          <AuthInputSkeleton />

          {/* Password Field */}
          <AuthInputSkeleton showRequirements={showPasswordRequirements} />

          {/* Submit Button */}
          <Skeleton className="h-10 w-full rounded-md" />
        </Stack>

        {/* Microsoft OAuth Button */}
        {showMicrosoftButton && (
          <>
            <HStack gap={2}>
              <div className="flex-1 h-px bg-muted" />
            </HStack>

            <Skeleton className="h-10 w-full rounded-md" />
          </>
        )}
      </Stack>
    </AuthFormLayout>
  );
}
