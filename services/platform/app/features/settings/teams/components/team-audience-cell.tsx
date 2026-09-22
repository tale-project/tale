'use client';

import { Badge } from '@tale/ui/badge';
import { TableIconCell } from '@tale/ui/data-table/table-icon-cell';
import { Row } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Globe, Users } from 'lucide-react';

/**
 * Team names beyond this fold into a `+n` count.
 *
 * ONE, because a chip carries its own padding and an audience column is a
 * secondary one: at two chips the documents list rendered the pair as
 * `Com…` `L…` — two names shown, neither readable. One chip takes the width
 * the column has; the rest stay on the `title` and the screen-reader twin.
 */
const MAX_VISIBLE_TEAMS = 1;

interface TeamAudienceLabels {
  /** The no-teams branch — everyone in the organization may open the row. */
  orgWide: string;
  /** A team id the directory no longer knows. */
  unknownTeam: string;
  /** The folded-away remainder, e.g. `+{count}`. */
  more: (count: number) => string;
}

interface TeamAudienceCellProps {
  /** The row's audience. Empty renders the organization-wide branch. */
  teamIds: readonly string[];
  /** Resolves a team id to its directory name; `undefined` = no longer known. */
  nameOf: (teamId: string) => string | undefined;
  /** Wording — each list keeps its own voice; the composition is shared. */
  labels: TeamAudienceLabels;
  /** The team directory is still loading, so no name can be resolved yet. */
  isLoading?: boolean;
}

/**
 * Who may open this row, as a list cell: a glyph, then either the
 * organization-wide label or the audience by name.
 *
 * ONE composition for every audience-scoped list (documents, projects), so a
 * reader who learns to read the column on one screen reads it the same on the
 * next. It goes through {@link TableIconCell}, which owns the 20px slot and the
 * 8px beside it — the same offset every other list's glyph-and-text cell uses.
 *
 * Names resolve through the org's team DIRECTORY, so a row shared with a team
 * the viewer is not in still says which. A team the directory no longer knows
 * reads as the `unknownTeam` label rather than disappearing: a cell that drops
 * what it cannot name reports a restricted row as having no audience at all.
 */
export function TeamAudienceCell({
  teamIds,
  nameOf,
  labels,
  isLoading = false,
}: TeamAudienceCellProps) {
  if (teamIds.length === 0) {
    return (
      <TableIconCell
        icon={<Globe />}
        label={
          <Text as="span" variant="caption" truncate title={labels.orgWide}>
            {labels.orgWide}
          </Text>
        }
      />
    );
  }

  if (isLoading) {
    return (
      <Skeletonize loading className="contents">
        <TableIconCell
          icon={<Users />}
          label={
            <SkeletonBox>
              <div className="h-5 w-20" />
            </SkeletonBox>
          }
        />
      </Skeletonize>
    );
  }

  const names = teamIds.map((teamId) => nameOf(teamId) ?? labels.unknownTeam);
  const shown = names.slice(0, MAX_VISIBLE_TEAMS);
  const hidden = names.slice(MAX_VISIBLE_TEAMS);
  const full = names.join(', ');

  return (
    <TableIconCell
      icon={<Users />}
      label={
        // The full audience rides on `title` so the folded names stay
        // reachable on hover, and on an `sr-only` twin so they stay reachable
        // without a pointer.
        <Row gap={1} className="min-w-0" title={full}>
          {shown.map((name, index) => (
            // Two teams can share a name once one of them is unknown, so the
            // position is what identifies a chip. The chip's own `title` would
            // be just its name — the whole audience is the useful hover, and a
            // chip is what the pointer lands on.
            <Badge
              key={`${index}-${name}`}
              variant="outline"
              className="truncate"
              title={full}
            >
              {name}
            </Badge>
          ))}
          {hidden.length > 0 && (
            <>
              <Text
                as="span"
                variant="caption"
                className="shrink-0"
                aria-hidden
              >
                {labels.more(hidden.length)}
              </Text>
              <span className="sr-only">{hidden.join(', ')}</span>
            </>
          )}
        </Row>
      }
    />
  );
}
