import { createFileRoute } from '@tanstack/react-router';
import { OrganizationFormClient } from '@/app/features/organization/components/organization-form-client';

export const Route = createFileRoute('/dashboard/create-organization')({
  component: CreateOrganizationPage,
});

function CreateOrganizationPage() {
  return <OrganizationFormClient />;
}
