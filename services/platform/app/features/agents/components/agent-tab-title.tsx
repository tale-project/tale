import { Text } from '@tale/ui/text';

interface AgentTabTitleProps {
  /** Section heading text for the tab (rendered as the content <h1>). */
  title: string;
  /** Supporting caption rendered under the heading. */
  subtitle: string;
}

/**
 * Section title block shared by the Agents page tabs (Overview, Catalog). Each
 * tab's content opened with this same wrapper + heading + caption; this is the
 * one extracted copy. Callers resolve their own i18n strings (each tab uses its
 * own namespace) and pass them in, so the rendered markup stays identical across
 * tabs without coupling to a single namespace.
 *
 * NOTE: the heading is an <h1> to preserve the routes' pre-existing rendered
 * markup byte-for-byte. The agents layout's AdaptiveHeaderTitle ("Agents") is
 * also an <h1>, so the page carries two <h1>s — a latent heading-hierarchy
 * issue that predates this extraction. Demoting this to <h2> is a deliberate
 * a11y change, not part of a behavior-preserving DRY extraction; make it
 * separately if desired.
 */
export function AgentTabTitle({ title, subtitle }: AgentTabTitleProps) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-base font-semibold">{title}</h1>
      <Text variant="caption" className="text-muted-foreground text-sm">
        {subtitle}
      </Text>
    </div>
  );
}
