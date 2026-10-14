'use client';

/**
 * The skills a message chose, as chips in the person's own bubble.
 *
 * A message that starts with `/docx` chose the docx skill; its bubble shows
 * the name as a chip in front of the words, the way the composer's picker
 * wrote it. Only names of skills the person can use are chips — any other
 * `/word` is text, as the turn read it (`lib/skills/slash.ts`). The stored
 * text stays as typed: copying or editing the message gives back `/docx`.
 */

import { Badge } from '@tale/ui/badge';
import { Row } from '@tale/ui/layout';
import { BookOpen } from 'lucide-react';
import { createContext, useContext } from 'react';

import { useT } from '@/lib/i18n/client';
import { leadingSkillNames } from '@/lib/skills/slash';

/** The names of the skills the person can use, as the chat surface read
 * them for its composer; empty where nobody provides them (a shared view). */
export const ChatSkillNamesContext = createContext<ReadonlySet<string>>(
  new Set(),
);

export function useChatSkillNames(): ReadonlySet<string> {
  return useContext(ChatSkillNamesContext);
}

/**
 * The chosen skills a message starts with, and the words after them: the
 * leading `/name` tokens that name a skill in `available`, as far as they
 * run. `null` when the message chose none.
 */
export function splitChosenSkills(
  text: string,
  available: ReadonlySet<string>,
): { skills: string[]; rest: string } | null {
  const names = leadingSkillNames(text);
  const skills: string[] = [];
  let rest = text;
  for (const name of names) {
    if (!available.has(name)) break;
    const token = new RegExp(`^\\s*/${name}(?=\\s|$)`).exec(rest);
    if (token === null) break;
    skills.push(name);
    rest = rest.slice(token[0].length);
  }
  return skills.length === 0
    ? null
    : { skills, rest: rest.replace(/^\s+/, '') };
}

export function ChosenSkillChips({ skills }: { skills: readonly string[] }) {
  const { t } = useT('chat');
  return (
    <Row gap={1} wrap align="center">
      {skills.map((name) => (
        <Badge key={name} variant="slate" icon={BookOpen}>
          <span className="sr-only">{`${t('skillChip.label')} `}</span>
          {name}
        </Badge>
      ))}
    </Row>
  );
}
