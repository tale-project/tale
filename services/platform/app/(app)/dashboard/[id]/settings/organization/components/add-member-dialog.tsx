'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

import { Check, X, Copy } from 'lucide-react';
import { ConvexHttpClient } from 'convex/browser';

const addMemberSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z
    .string()
    .optional()
    .refine(
      (val) => {
        // If password is provided, it must meet requirements
        if (!val || val.length === 0) return true;
        return (
          val.length >= 8 &&
          /[a-z]/.test(val) &&
          /[A-Z]/.test(val) &&
          /\d/.test(val)
        );
      },
      {
        message:
          'Password must be at least 8 characters with uppercase, lowercase, and number',
      },
    ),
  displayName: z.string().optional(),
  role: z.enum(['disabled', 'admin', 'developer', 'editor', 'member']),
});

type AddMemberFormData = z.infer<typeof addMemberSchema>;

interface AddMemberDialogProps {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AddMemberDialog({
  organizationId,
  open,
  onOpenChange,
}: AddMemberDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const { toast } = useToast();

  const addMember = useMutation(api.member.addMember);
  const createMember = useMutation(api.users.createMember);
  const form = useForm<AddMemberFormData>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: {
      email: '',
      password: '',
      displayName: '',
      role: 'member',
    },
  });

  const { handleSubmit, register, reset, setValue, watch, formState } = form;
  const selectedRole = watch('role');
  const password = watch('password') ?? '';

  // Password validation checks
  const passwordChecks = {
    length: password.length >= 8,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /\d/.test(password),
  };

  const handleCopy = async (text: string, type: 'email' | 'password') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'email') {
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 2000);
      } else {
        setCopiedPassword(true);
        setTimeout(() => setCopiedPassword(false), 2000);
      }
    } catch (error) {
      console.error(error);
      toast({
        title: 'Failed to copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  const onSubmit = async (data: AddMemberFormData) => {
    setIsSubmitting(true);
    try {
      let userId: string | undefined;
      let isNewUser = false;

      // First, check if user already exists
      const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;
      const client = new ConvexHttpClient(convexUrl);

      const existingUserId = await client.query(api.member.getUserIdByEmail, {
        email: data.email,
      });

      if (existingUserId) {
        // User already exists - just add them to the organization
        userId = existingUserId;
        isNewUser = false;

        // Add existing user to organization
        await addMember({
          organizationId: organizationId as string,
          email: data.email,
          userId: userId as string,
          role: data.role,
          displayName: data.displayName,
        });
      } else {
        // User doesn't exist - create new account SERVER-SIDE
        // This won't affect the admin's session!
        if (!data.password || data.password.length === 0) {
          throw new Error(
            'Password is required to create a new user account. ' +
              'If the user already has an account, they will be added without needing a password.',
          );
        }

        // Use server-side mutation that creates user WITHOUT creating a session
        // This keeps the admin logged in!
        await createMember({
          organizationId: organizationId as string,
          email: data.email,
          password: data.password,
          displayName: data.displayName,
          role: data.role,
        });

        isNewUser = true;

        // Store credentials for display
        setCredentials({
          email: data.email,
          password: data.password,
        });
      }

      // Success! Show credentials modal only for new users
      toast({
        title: isNewUser
          ? 'New member created and added to organization'
          : 'Existing user added to organization',
        variant: 'success',
      });

      if (isNewUser && data.password) {
        // Only show credentials for newly created accounts
        setCredentials({
          email: data.email,
          password: data.password,
        });
        setShowCredentials(true);
      } else {
        // For existing users, just close the dialog
        reset();
        setIsSubmitting(false);
        onOpenChange(false);
      }
    } catch (error) {
      console.error(error);
      toast({
        title: 'Failed to add member',
        variant: 'destructive',
      });
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setShowCredentials(false);
    setCredentials(null);
    setCopiedEmail(false);
    setCopiedPassword(false);
    reset();
    setIsSubmitting(false);
    onOpenChange(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !showCredentials) {
      reset();
    }
    onOpenChange(open);
  };

  return (
    <>
      {/* Add Member Form Dialog */}
      <Dialog open={open && !showCredentials} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
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
              />
            </div>

            {/* Email Field */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter email address"
                {...register('email')}
                className="w-full"
                required
              />
              {formState.errors.email && (
                <p className="text-sm text-red-500">
                  {formState.errors.email.message}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter password"
                {...register('password')}
                className="w-full"
              />
              {password && (
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-1.5">
                    {passwordChecks.length ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span
                      className={
                        passwordChecks.length
                          ? 'text-green-600'
                          : 'text-muted-foreground'
                      }
                    >
                      At least 8 characters
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {passwordChecks.lowercase ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span
                      className={
                        passwordChecks.lowercase
                          ? 'text-green-600'
                          : 'text-muted-foreground'
                      }
                    >
                      One lowercase letter
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {passwordChecks.uppercase ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span
                      className={
                        passwordChecks.uppercase
                          ? 'text-green-600'
                          : 'text-muted-foreground'
                      }
                    >
                      One uppercase letter
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {passwordChecks.number ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span
                      className={
                        passwordChecks.number
                          ? 'text-green-600'
                          : 'text-muted-foreground'
                      }
                    >
                      One number
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Role Field */}
            <div className="space-y-2">
              <Label htmlFor="role" className="text-sm font-medium">
                Role
              </Label>
              <Select
                value={selectedRole}
                onValueChange={(value) =>
                  setValue(
                    'role',
                    value as
                      | 'disabled'
                      | 'admin'
                      | 'developer'
                      | 'editor'
                      | 'member',
                  )
                }
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
              <Button type="submit" disabled={isSubmitting} className="flex-1">
                {isSubmitting ? 'Adding...' : 'Add member'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Credentials Display Dialog */}
      <Dialog open={showCredentials} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Member added successfully</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-yellow-50 p-4 text-sm text-yellow-800 border border-yellow-200">
              <strong>Important:</strong> Save these credentials now. They
              won&apos;t be shown again.
            </div>

            {credentials && (
              <div className="space-y-4">
                {/* Email */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Email</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={credentials.email}
                      readOnly
                      className="flex-1 font-mono text-sm"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="p-1"
                      onClick={() => handleCopy(credentials.email, 'email')}
                    >
                      {copiedEmail ? (
                        <Check className="size-4 text-success p-0.5" />
                      ) : (
                        <Copy className="size-4 p-0.5" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Password</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={credentials.password}
                      readOnly
                      className="flex-1 font-mono text-sm"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="p-1"
                      onClick={() =>
                        handleCopy(credentials.password, 'password')
                      }
                    >
                      {copiedPassword ? (
                        <Check className="size-4 text-success p-0.5" />
                      ) : (
                        <Copy className="size-4 p-0.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
