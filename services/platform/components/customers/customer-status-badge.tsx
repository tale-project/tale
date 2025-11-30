import { Badge } from '@/components/ui/badge';
import { Doc } from '@/convex/_generated/dataModel';

// Stub type for customer status - matches Convex schema
type CustomerStatus = Doc<'customers'>['status'];

const getStatusConfig = (status: CustomerStatus) => {
  switch (status) {
    case 'active':
      return {
        variant: 'green' as const,
        label: 'Active',
      };
    case 'churned':
      return {
        variant: 'destructive' as const,
        label: 'Churned',
      };
    case 'potential':
      return {
        variant: 'yellow' as const,
        label: 'Potential',
      };
    default:
      return {
        variant: 'outline' as const,
        label: status,
      };
  }
};

export function CustomerStatusBadge({ status }: { status?: CustomerStatus }) {
  const config = getStatusConfig(status);

  return (
    <Badge variant={config.variant} dot>
      {config.label}
    </Badge>
  );
}
