import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // The app opens on its first section.
    throw redirect({ to: '/sessions', replace: true });
  },
});
