import { Button } from '@tale/ui/button';
import { Toaster } from '@tale/ui/toaster';
import { useToast } from '@tale/ui/use-toast';

export default function ToastBasic() {
  const { toast } = useToast();

  return (
    <div className="flex flex-col items-center gap-3">
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            title: 'Settings saved',
            description: 'Members see the new name on their next request.',
          })
        }
      >
        Save settings
      </Button>
      <Toaster />
    </div>
  );
}
