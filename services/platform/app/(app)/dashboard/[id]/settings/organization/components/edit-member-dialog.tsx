'use client';

import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from '@/hooks/use-toast';

const editMemberSchema = z.object({
  displayName: z.string().min(1, 'Name is required'),
  role: z.enum(['disabled', 'admin', 'developer', 'editor', 'member']),
  email: z.string().email('Please enter a valid email address'),
  updatePassword: z.boolean().optional(),
  password: z.string().optional(),
});

type EditMemberFormData = z.infer<typeof editMemberSchema>;

type MemberLite = {
  _id: string;
  displayName?: string;
  role?: string;
  email?: string;
};

interface EditMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MemberLite | null;
  currentUserMemberId?: string;
}

export default function EditMemberDialog({
  open,
  onOpenChange,
  member,
  currentUserMemberId,
}: EditMemberDialogProps) {
  const form = useForm<EditMemberFormData>({
    resolver: zodResolver(editMemberSchema),
    defaultValues: {
      displayName: member?.displayName,
      role: member?.role as any as
        | 'disabled'
        | 'admin'
        | 'developer'
        | 'editor'
        | 'member'
        | undefined,
      email: member?.email,
      updatePassword: false,
      password: '',
    },
  });

  const updateMemberRole = useMutation(api.member.updateMemberRole);

  const handleUpdateMember = async (
    memberId: string,
    data: {
      displayName: string;
      role: 'disabled' | 'admin' | 'developer' | 'editor' | 'member';
      email: string;
    },
  ) => {
    try {
      await updateMemberRole({
        memberId,
        role: data.role,
      });

      toast({
        title: 'Member updated successfully',
        variant: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: 'Failed to update member',
        variant: 'destructive',
      });
    }
  };

  const { handleSubmit, register, reset, watch, formState } = form;
  const { isSubmitting, isDirty } = formState;

  const isEditingSelf = currentUserMemberId === member?._id;

  const onSubmit = async (data: EditMemberFormData) => {
    if (!member) return;
    await handleUpdateMember(member._id, data);
    onOpenChange(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      reset();
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit member</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Name Field */}
          <div className="space-y-2">
            <Label htmlFor="displayName" className="text-sm font-medium">
              Name
            </Label>
            <Input
              id="displayName"
              placeholder="Enter full name"
              {...register('displayName')}
              className="w-full"
              required
            />
          </div>

          {/* Email Field - Read-only */}
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="Enter email address"
              {...register('email')}
              className="w-full bg-muted"
              disabled
              required
            />
            <p className="text-xs text-muted-foreground">
              Email cannot be changed
            </p>
          </div>

          {/* Role Field */}
          <div className="space-y-2">
            <Label htmlFor="role" className="text-sm font-medium">
              Role
            </Label>
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={isEditingSelf}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="developer">Developer</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {isEditingSelf && (
              <p className="text-sm text-muted-foreground">
                You cannot change your own role
              </p>
            )}
            {!isEditingSelf &&
              member?.role === 'admin' &&
              watch('role') !== 'admin' && (
                <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
                  <p className="text-sm text-amber-800">
                    <strong>Warning:</strong> Your organization should have at
                    least 2 admins for security. This change will be blocked if
                    it would leave fewer than 2 admins.
                  </p>
                </div>
              )}
          </div>

          {/* Password Update Section */}
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center space-x-2">
              <Controller
                control={form.control}
                name="updatePassword"
                render={({ field }) => (
                  <Checkbox
                    id="updatePassword"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Label
                htmlFor="updatePassword"
                className="text-sm font-medium cursor-pointer"
              >
                Update password
              </Label>
            </div>

            {watch('updatePassword') && (
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter new password"
                  {...register('password')}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  User must update the password on login
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !isDirty}
              className="flex-1"
            >
              {isSubmitting ? 'Updating...' : 'Update'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
