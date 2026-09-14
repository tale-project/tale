import { Button } from '@tale/ui/button';
import { Toaster } from '@tale/ui/toaster';
import { useToast } from '@tale/ui/use-toast';

export default function ToastVariants() {
  const { toast } = useToast();

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          variant="secondary"
          onClick={() =>
            toast({ variant: 'success', title: 'Provider connected' })
          }
        >
          Success
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast({
              variant: 'destructive',
              title: 'Could not reach the provider',
              description: 'Check the base URL and the API key.',
            })
          }
        >
          Destructive
        </Button>
      </div>
      <Toaster />
    </div>
  );
}
