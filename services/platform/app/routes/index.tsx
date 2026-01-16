import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/log-in' });
  },
  component: IndexPage,
});

function IndexPage() {
  return null;
}
