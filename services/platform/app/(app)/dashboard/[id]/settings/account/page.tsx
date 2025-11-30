'use client';

import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useParams } from 'next/navigation';

interface PasswordFormData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export default function AccountPage() {
  const params = useParams();
  const organizationId = params.id as string;

  const memberContext = useQuery(api.member.getCurrentMemberContext, {
    organizationId,
  });

  if (memberContext && !memberContext.canChangePassword) {
    return (
      <div className="flex justify-center py-6">
        <div className="w-full max-w-md text-sm text-muted-foreground">
          Account details and passwords are managed by your identity provider and
          can't be changed here.
        </div>
      </div>
    );
  }

  const updatePassword = useMutation(api.users.updateUserPassword);
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
  } = useForm<PasswordFormData>({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const newPassword = watch('newPassword');

  const onSubmit = async (data: PasswordFormData) => {
    try {
      await updatePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });

      toast({
        title: 'Success',
        description: 'Password changed successfully',
      });

      // Clear form
      reset();
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to change password. Please check your current password and try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex justify-center py-6">
      <div className="w-full max-w-md">
        <h2 className="text-lg font-semibold mb-6">Change password</h2>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Current Password */}
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              placeholder="Enter current password"
              disabled={isSubmitting}
              errorMessage={errors.currentPassword?.message}
              {...register('currentPassword', {
                required: 'Current password is required',
              })}
            />
          </div>

          {/* New Password */}
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              placeholder="Enter new password"
              disabled={isSubmitting}
              errorMessage={errors.newPassword?.message}
              {...register('newPassword', {
                required: 'New password is required',
                minLength: {
                  value: 8,
                  message: 'Password must be at least 8 characters long',
                },
              })}
            />
          </div>

          {/* Confirm New Password */}
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              placeholder="Confirm new password"
              disabled={isSubmitting}
              errorMessage={errors.confirmPassword?.message}
              {...register('confirmPassword', {
                required: 'Please confirm your new password',
                validate: (value) =>
                  value === newPassword || 'Passwords do not match',
              })}
            />
          </div>

          {/* Submit Button */}
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Saving...' : 'Save changes'}
          </Button>
        </form>
      </div>
    </div>
  );
}
