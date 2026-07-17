/**
 * Episode 6 — "Projects: the team and the AI at one table". The shared
 * workspace deep dive: the board mid-flight, project files as scoped
 * context, discussions beside the work — then the live centerpiece: a task
 * created ON CAMERA, the triage automation scoring it, and an agent picking
 * it up while we watch. Backlog proposals close the loop: agents propose,
 * humans promote.
 *
 * AI-literacy beats: agents work alongside people, not instead of them;
 * initiative stays human (a person creates, promotes, and can always take
 * the task back).
 *
 * The on-camera task pairs with its DOCS_TRIAGE_SCORES entry (confidence
 * above the auto-assign bar so the agent visibly takes it) and is archived
 * off camera via the `cleanupTaskTitles` note.
 */

import type { EpisodeSpec, Locale } from '../../lib/episode';

/** The task created on camera — pairs with DOCS_TRIAGE_SCORES per locale. */
export const CAMERA_TASK_TITLE: Record<Locale, string> = {
  en: 'Draft the launch announcement post',
  de: 'Launch-Ankündigung entwerfen',
  fr: 'Rédiger l’annonce de lancement',
};

export const EP6_PROJECTS: EpisodeSpec = {
  id: 'ep6-projects',
  section: 'tutorials',
  titleByLocale: {
    en: 'Projects: the team and the AI at one table',
    de: 'Projekte: Team und KI an einem Tisch',
    fr: 'Projets : l’équipe et l’IA à la même table',
  },
  episodeLabelByLocale: {
    en: 'Episode 6',
    de: 'Episode 6',
    fr: 'Épisode 6',
  },
  needsKnowledgeDb: true,
  wholeTakeLocales: ['en'],
  voices: {
    en: 'WZlYpi1yf6zJhNWXih74',
    de: 'rKiu7lQ4c5P3az3745s3',
    fr: 'QbsdzCokdlo98elkq4Pc',
  },
  /** Unused on camera (no chat scene); kept for the spec contract. */
  heroPromptByLocale: {
    en: 'Draft the launch announcement post',
    de: 'Launch-Ankündigung entwerfen',
    fr: 'Rédiger l’annonce de lancement',
  },
  scenes: [
    {
      id: 'title',
      leadInMs: 1200,
      narration: {
        en: 'Chat is where you ask; projects are where the work lives. This episode: shared files, honest boards, discussions next to the tasks — and an agent picking up work while you watch.',
        de: 'Im Chat fragst du; in Projekten wohnt die Arbeit. In dieser Episode: gemeinsame Dateien, ehrliche Boards, Diskussionen neben den Aufgaben — und ein Agent, der Arbeit übernimmt, während du zusiehst.',
        fr: 'Le chat, c’est là où tu demandes ; les projets, là où vit le travail. Dans cet épisode : fichiers partagés, tableaux honnêtes, discussions à côté des tâches — et un agent qui prend du travail sous tes yeux.',
      },
    },
    {
      id: 'board',
      chapterByLocale: { en: 'The board', de: 'Das Board', fr: 'Le tableau' },
      chapterTransition: 'cut',
      minMs: 13_000,
      narration: {
        en: 'This is the website relaunch, mid-flight. Columns tell the truth: what waits, what runs, what is stuck in review. People and agents share this board — the avatars tell you who holds what.',
        de: 'Das ist der Website-Relaunch, mitten im Flug. Die Spalten sagen die Wahrheit: was wartet, was läuft, was im Review hängt. Menschen und Agenten teilen sich dieses Board — die Avatare zeigen, wer was hält.',
        fr: 'Voici la refonte du site, en plein vol. Les colonnes disent la vérité : ce qui attend, ce qui tourne, ce qui bloque en revue. Humains et agents partagent ce tableau — les avatars disent qui tient quoi.',
      },
    },
    {
      id: 'files',
      minMs: 12_000,
      narration: {
        en: 'Every project carries its own shelf of context: the content inventory, the launch-day runbook. Agents working inside this project read these first — scoped knowledge, exactly like episode three taught.',
        de: 'Jedes Projekt trägt sein eigenes Kontextregal: das Content-Inventar, das Launch-Runbook. Agenten, die in diesem Projekt arbeiten, lesen zuerst hier — begrenztes Wissen, genau wie in Episode drei gelernt.',
        fr: 'Chaque projet porte son étagère de contexte : l’inventaire de contenu, le runbook du jour J. Les agents qui travaillent dans ce projet lisent ici d’abord — un savoir borné, exactement comme à l’épisode trois.',
      },
    },
    {
      id: 'discussions',
      minMs: 13_000,
      narration: {
        en: 'Decisions live next to the work, not in a lost thread. Open questions get a discussion; mention an agent with an at-sign and it joins with the project context already loaded.',
        de: 'Entscheidungen wohnen neben der Arbeit, nicht in einem verlorenen Thread. Offene Fragen bekommen eine Diskussion; erwähne einen Agenten mit At-Zeichen, und er steigt ein — den Projektkontext schon geladen.',
        fr: 'Les décisions vivent à côté du travail, pas dans un fil perdu. Les questions ouvertes ont leur discussion ; mentionne un agent avec une arobase et il arrive, le contexte du projet déjà chargé.',
      },
    },
    {
      id: 'task-create',
      chapterByLocale: {
        en: 'A task for the AI',
        de: 'Eine Aufgabe für die KI',
        fr: 'Une tâche pour l’IA',
      },
      // Create dialog + typed title + save.
      minMs: 15_000,
      narration: {
        en: 'Now the centerpiece. We create a task the usual way — a title, to do, save. Nothing special about it. Except this workspace runs the triage automation from last episode… so watch what happens next.',
        de: 'Jetzt das Herzstück. Wir legen eine Aufgabe ganz normal an — Titel, zu erledigen, speichern. Nichts Besonderes daran. Außer dass hier die Triage-Automatisierung aus der letzten Episode läuft … also sieh hin, was jetzt passiert.',
        fr: 'La pièce maîtresse. On crée une tâche comme d’habitude — un titre, à faire, enregistrer. Rien de spécial. Sauf que cet espace fait tourner le triage de l’épisode précédent… alors regarde ce qui suit.',
      },
    },
    {
      id: 'agent-takes',
      // The triage run scores, assigns, and the card visibly changes hands.
      minMs: 20_000,
      narration: {
        en: 'The automation scored it, judged it a fit, and assigned it — the agent’s name lands on the card. Open it, and the reasoning sits right there as a comment: why this agent, in plain language. Had the score been low, there would be only a suggestion — and the decision would stay with a person.',
        de: 'Die Automatisierung hat bewertet, für passend befunden und zugewiesen — der Name des Agenten erscheint auf der Karte. Öffne sie, und die Begründung steht direkt als Kommentar da: warum dieser Agent, in klaren Worten. Wäre der Wert niedrig gewesen, gäbe es nur einen Vorschlag — und die Entscheidung bliebe bei einem Menschen.',
        fr: 'Le triage a noté, jugé que ça convenait, et assigné — le nom de l’agent arrive sur la carte. Ouvre-la : la justification est là, en commentaire, en langage clair. Si le score avait été bas, il n’y aurait eu qu’une suggestion — et la décision serait restée humaine.',
      },
    },
    {
      id: 'backlog',
      minMs: 12_000,
      narration: {
        en: 'The backlog closes the loop. Agents can propose work they think is needed — but proposals sit here until a person promotes them. Initiative stays human. The AI suggests; you decide what enters the sprint.',
        de: 'Das Backlog schließt den Kreis. Agenten können Arbeit vorschlagen, die sie für nötig halten — aber Vorschläge liegen hier, bis ein Mensch sie befördert. Die Initiative bleibt beim Menschen. Die KI schlägt vor; du entscheidest, was in den Sprint kommt.',
        fr: 'Le backlog boucle la boucle. Les agents peuvent proposer du travail qu’ils jugent nécessaire — mais les propositions restent ici jusqu’à ce qu’une personne les promeuve. L’initiative reste humaine. L’IA suggère ; tu décides de ce qui entre dans le sprint.',
      },
    },
    {
      id: 'curation',
      narration: {
        en: 'And each project chooses its own crew: which agents may work here, which models they may use. A project is a trust boundary too — staff it deliberately, like any team.',
        de: 'Und jedes Projekt wählt seine eigene Crew: welche Agenten hier arbeiten dürfen, welche Modelle sie nutzen. Auch ein Projekt ist eine Vertrauensgrenze — besetze es bewusst, wie jedes Team.',
        fr: 'Et chaque projet choisit son équipage : quels agents peuvent y travailler, quels modèles ils peuvent utiliser. Un projet aussi est une frontière de confiance — compose-le délibérément, comme toute équipe.',
      },
    },
    {
      id: 'recap',
      narration: {
        en: 'Projects: shared context, an honest board, agents that take work and propose it — with people deciding what counts. Next episode: integrations — where your workspace meets the outside world.',
        de: 'Projekte: gemeinsamer Kontext, ein ehrliches Board, Agenten, die Arbeit übernehmen und vorschlagen — und Menschen, die entscheiden, was zählt. Nächste Episode: Integrationen — wo dein Arbeitsbereich auf die Außenwelt trifft.',
        fr: 'Les projets : un contexte partagé, un tableau honnête, des agents qui prennent du travail et en proposent — et des humains qui décident de ce qui compte. Prochain épisode : les intégrations — là où ton espace rencontre le monde extérieur.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'The projects section of the documentation covers boards, backlogs, and task automation in full. See you in episode seven.',
        de: 'Der Projekte-Bereich der Dokumentation behandelt Boards, Backlogs und Aufgaben-Automatisierung vollständig. Bis zur siebten Episode.',
        fr: 'La section Projets de la documentation couvre tableaux, backlog et automatisation des tâches en détail. À bientôt pour l’épisode sept.',
      },
    },
  ],
} as const;
