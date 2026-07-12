import { createFileRoute, redirect } from '@tanstack/react-router';

// Customers + vendors merged into a single Contacts entity (#2618). Kept as a
// redirect so existing links / bookmarks keep working (#2634).
export const Route = createFileRoute('/dashboard/$id/_knowledge/vendors')({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/contacts',
      params: { id: params.id },
    });
  },
});
