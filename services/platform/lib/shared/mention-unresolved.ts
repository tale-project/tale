/**
 * Client helper: surface when `@`-tokens in a message did not resolve to a
 * teammate or agent, so the user knows no notification was sent.
 */

export function toastUnresolvedMentions(
  tokens: string[] | undefined,
  toast: (args: {
    title: string;
    description?: string;
    variant?: 'default' | 'destructive';
  }) => void,
  t: (key: string, params?: Record<string, string>) => string,
): void {
  if (!tokens || tokens.length === 0) return;
  toast({
    title: t('mentions.unresolvedTitle'),
    description: t('mentions.unresolvedDescription', {
      tokens: tokens.map((token) => `@${token}`).join(', '),
    }),
  });
}
