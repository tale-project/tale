import { createFileRoute, notFound } from '@tanstack/react-router';

import { LegalPage } from '@/app/pages/legal-page';
import { isLegalSlug } from '@/lib/legal/slugs';

export const Route = createFileRoute('/$lang/legal/$slug')({
  beforeLoad: ({ params }) => {
    if (!isLegalSlug(params.slug)) {
      throw notFound();
    }
  },
  component: LangLegalSlugRoute,
});

function LangLegalSlugRoute() {
  const { slug } = Route.useParams();
  if (!isLegalSlug(slug)) return null;
  return <LegalPage slug={slug} />;
}
