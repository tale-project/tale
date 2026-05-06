import { createFileRoute } from '@tanstack/react-router';

import { ContactPage } from '@/app/pages/contact-page';

export const Route = createFileRoute('/$lang/contact')({
  component: ContactPage,
});
