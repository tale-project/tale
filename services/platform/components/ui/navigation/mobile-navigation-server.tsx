import { MobileNavigation } from './mobile-navigation';

interface MobileNavigationServerProps {
  role: string | null;
}

export function MobileNavigationServer({
  role,
}: MobileNavigationServerProps) {
  return <MobileNavigation role={role} />;
}
