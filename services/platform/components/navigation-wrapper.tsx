'use client';

import Navigation from './navigation';
import { api } from '@/convex/_generated/api';
import { useQuery } from 'convex/react';

interface NavigationWrapperProps {
  organizationId: string;
}

export default function NavigationWrapper({
  organizationId,
}: NavigationWrapperProps) {
  const memberContext = useQuery(api.member.getCurrentMemberContext, {
    organizationId,
  });

  const role = memberContext?.role ?? null;

  return <Navigation role={role} />;
}
