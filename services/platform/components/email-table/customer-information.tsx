import { CustomerStatusBadge } from '../customers/customer-status-badge';
import { formatDate } from '@/lib/utils/date/format';
import { Doc } from '@/convex/_generated/dataModel';

interface CustomerInformationProps {
  customer: Doc<'customers'>;
}

export function CustomerInformation({ customer }: CustomerInformationProps) {
  if (!customer) return null;

  return (
    <>
      {/* Customer Info Section */}
      <div className="space-y-5">
        {/* Customer Name & Email */}
        <div className="space-y-1">
          <div className="text-lg font-semibold text-foreground leading-none">
            {customer.name || 'N/A'}
          </div>
          <div className="text-sm text-muted-foreground tracking-tight">
            {customer.email || 'N/A'}
          </div>
        </div>

        {/* Customer Details Grid */}
        <div className="space-y-3">
          <div className="flex items-center">
            <div className="text-xs text-muted-foreground tracking-tight w-[5.625rem]">
              Status
            </div>
            {customer.status && (
              <CustomerStatusBadge status={customer.status} />
            )}
          </div>

          <div className="flex items-center">
            <div className="text-xs text-muted-foreground tracking-tight w-[5.625rem]">
              Source
            </div>
            <div className="text-sm font-medium text-foreground tracking-tight">
              {customer.source || 'N/A'}
            </div>
          </div>

          <div className="flex items-center">
            <div className="text-xs text-muted-foreground tracking-tight w-[5.625rem]">
              Created at
            </div>
            <div className="text-sm font-medium text-foreground tracking-tight">
              {customer._creationTime
                ? formatDate(new Date(customer._creationTime), {
                    preset: 'long',
                  })
                : 'N/A'}
            </div>
          </div>

          <div className="flex items-center">
            <div className="text-xs text-muted-foreground tracking-tight w-[5.625rem]">
              Locale
            </div>
            <div className="text-base font-medium text-foreground tracking-tight">
              {customer.locale || 'en'}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
