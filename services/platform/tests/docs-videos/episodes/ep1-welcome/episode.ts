/**
 * Episode 1 — "Welcome to Tale". The series opener stays the SHORT trailer
 * (~3:30–4:00, deliberately under the in-depth band): a guided tour of the
 * workspace where every stop shows an artifact — a grounded answer streams
 * in, the cited file is found in Knowledge, the agent behind the reply is
 * opened, the triage automation's journal proves it ran during the video.
 *
 * Register (produce-video STORYBOARD.md): a colleague showing you at your
 * desk — and TUTORIAL GRAMMAR: the voice announces every move before it
 * happens (signpost → action → observation → meaning), and silence does the
 * pacing — generous lead-ins after every cut, a tail beat after every landed
 * point. Narration is written natively per locale (write-translations). The
 * hero prompt pairs 1:1 with its scripted reply in
 * `lib/mocks/overrides/docs-replies.ts` — the prompt must contain the
 * reply's `match` clause, or the take streams the visibly synthetic e2e
 * canned reply.
 */

import type { EpisodeSpec } from '../../lib/episode';

export const EP1_WELCOME: EpisodeSpec = {
  id: 'ep1-welcome',
  section: 'tutorials',
  titleByLocale: {
    en: 'Welcome to Tale',
    de: 'Willkommen bei Tale',
    fr: 'Bienvenue dans Tale',
  },
  episodeLabelByLocale: {
    en: 'Episode 1',
    de: 'Episode 1',
    fr: 'Épisode 1',
  },
  needsKnowledgeDb: true,
  wholeTakeLocales: ['en'],
  /** Auditioned 2026-07-16 (twice): EN Hope — "Professional, Clear and
   * Natural", American, from the voice LIBRARY like the approved de/fr
   * voices (premade Alice read too British, premade Bella too synthetic);
   * DE Carla Blum, FR Koraly. Alternates in .state/audition/. */
  voices: {
    en: 'WZlYpi1yf6zJhNWXih74',
    de: 'rKiu7lQ4c5P3az3745s3',
    fr: 'QbsdzCokdlo98elkq4Pc',
  },
  /** The live chat question typed on camera. Each locale's prompt CONTAINS
   * its docs-replies match clause (see DOCS_REPLIES, video entries). */
  heroPromptByLocale: {
    en: 'What did customers say about onboarding last quarter?',
    de: 'Was haben unsere Kunden im letzten Quartal zum Onboarding gesagt?',
    fr: 'Que disent nos clients de l’onboarding au dernier trimestre ?',
  },
  scenes: [
    {
      // Cold open over the chat (the warmup's settled end surface). The
      // card lifts at a cue BEFORE the voice names the surface behind it.
      id: 'title',
      leadInMs: 1600,
      minMs: 18_000,
      narration: {
        en: 'Welcome to Tale — and welcome to this series. This first episode is the quick tour: we’ll walk the workspace together, one area at a time, and you’ll watch it answer a real question along the way. Here’s where we start — the chat.',
        de: 'Willkommen bei Tale — und zu dieser Serie. Diese erste Episode ist die kurze Tour: Wir gehen den Arbeitsbereich zusammen durch, Bereich für Bereich — und unterwegs siehst du, wie er eine echte Frage beantwortet. Hier geht es los — im Chat.',
        fr: 'Bienvenue dans Tale — et dans cette série. Ce premier épisode, c’est la visite rapide : on traverse l’espace de travail ensemble, un domaine à la fois, et tu verras une vraie question obtenir sa réponse. On commence ici — dans le chat.',
      },
    },
    {
      // The map before the first move: the cursor walks the rail as the
      // voice names each area, in the order the tour will visit them.
      id: 'dashboard',
      leadInMs: 1200,
      tailMs: 1500,
      minMs: 17_000,
      narration: {
        en: 'Before we type anything, take a second to read the sidebar. Chat at the top — then projects, agents, automations, and the knowledge your company runs on. Every stop on today’s tour is one click in this rail.',
        de: 'Bevor wir etwas tippen, lies kurz die Seitenleiste. Ganz oben der Chat — dann Projekte, Agenten, Automatisierungen und das Wissen deiner Firma. Jede Station der heutigen Tour ist von hier einen Klick entfernt.',
        fr: 'Avant d’écrire quoi que ce soit, lis d’abord la barre latérale. Le chat en haut — puis les projets, les agents, les automatisations et les connaissances de l’entreprise. Chaque étape du jour est à un clic d’ici.',
      },
    },
    {
      // The hero ask: @-mention attach + the typed question. The typing
      // choreography (picker + ~60-char prompt + send) needs the minMs
      // window even when a locale's narration runs shorter.
      id: 'chat-ask',
      chapterByLocale: { en: 'Chat', de: 'Chat', fr: 'Chat' },
      leadInMs: 1200,
      tailMs: 1400,
      // Real fr audio runs ~19% shorter than the estimate — the @-mention +
      // 60-char prompt typing needs this floor under the fastest locale.
      minMs: 18_000,
      narration: {
        en: 'You can ask the model anything here. The real power is asking about your own work — so let’s do that. We attach a company document as context… the Q2 support review… and ask what customers said about onboarding last quarter. And send.',
        de: 'Du kannst das Modell hier alles fragen. Richtig stark wird es bei deiner eigenen Arbeit — also los. Wir hängen ein Firmendokument an … den Q2-Support-Bericht … und fragen, was Kunden im letzten Quartal zum Onboarding gesagt haben. Und abschicken.',
        fr: 'Tu peux tout demander ici. La vraie force, c’est de l’interroger sur ton propre travail — alors faisons-le. On attache un document de l’entreprise… la revue support du T2… et on demande ce que disent nos clients de l’onboarding au dernier trimestre. On envoie.',
      },
    },
    {
      // The reply streams (reasoning first — mock gateway, paced for
      // camera); the voice reads the screen, then points at the sources.
      id: 'chat-stream',
      leadInMs: 800,
      tailMs: 1600,
      minMs: 14_500,
      narration: {
        en: 'Now watch what comes back. First, the model’s reasoning — how it plans to answer. Then the answer itself, streaming in. And read the last line: it names the documents it used. Keep that in mind.',
        de: 'Jetzt schau, was zurückkommt. Zuerst die Überlegungen des Modells — wie es die Antwort plant. Dann die Antwort selbst. Und lies die letzte Zeile: Da stehen die Dokumente, die es benutzt hat. Merk sie dir.',
        fr: 'Regarde ce qui revient. D’abord le raisonnement du modèle — comment il compte répondre. Puis la réponse. Et lis la dernière ligne : elle nomme les documents utilisés. Garde-la en tête.',
      },
    },
    {
      // The honest hallucination beat — the camera rests on the cited
      // answer while the voice lands the point. Stillness is the point.
      id: 'ai-grounding',
      leadInMs: 900,
      tailMs: 1700,
      minMs: 17_500,
      narration: {
        en: 'Here’s why that matters. Without your documents, a model still answers — fluent, confident, and sometimes wrong. It has never seen your customers. Grounded like this, every claim traces back to a file you can open and check.',
        de: 'Und darum ist das wichtig: Ohne deine Dokumente antwortet ein Modell trotzdem — flüssig, überzeugt und manchmal falsch. Es hat deine Kunden nie gesehen. So verankert führt jede Aussage zu einer Datei, die du öffnen und prüfen kannst.',
        fr: 'Voilà pourquoi ça compte. Sans tes documents, un modèle répond quand même — avec aisance, et parfois à tort. Il n’a jamais vu tes clients. Ancrée comme ça, chaque affirmation remonte à un fichier que tu peux ouvrir et vérifier.',
      },
    },
    {
      // Close the loop: the answer cited a document — go find that file.
      id: 'knowledge',
      chapterByLocale: { en: 'Knowledge', de: 'Wissen', fr: 'Connaissances' },
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 16_000,
      narration: {
        en: 'The answer cited the Q2 support review — so let’s find that exact file. We open Knowledge in the sidebar… and there it is, indexed and ready. Everything in this library, your agents can search and cite the same way.',
        de: 'Die Antwort hat den Q2-Support-Bericht zitiert — suchen wir genau diese Datei. Wir öffnen Wissen in der Seitenleiste … und da ist sie, indexiert und bereit. Alles hier drin können deine Agenten durchsuchen und zitieren.',
        fr: 'La réponse a cité la revue support du T2 — allons trouver le fichier lui-même. On ouvre Connaissances dans la barre latérale… et le voilà, indexé et prêt. Tout ce qui vit ici, tes agents peuvent le chercher et le citer.',
      },
    },
    {
      // Who answered? Agents: the Chat folder, then the Assistant itself.
      id: 'agents',
      chapterByLocale: { en: 'Agents', de: 'Agenten', fr: 'Agents' },
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 17_000,
      narration: {
        en: 'Next question: who answered us just now? We open Agents… the Chat folder… and here it is — the Assistant. An agent is AI with a job description: instructions, a model, tools, and the knowledge it may use. Build it once; the whole team uses it.',
        de: 'Wer hat uns eben geantwortet? Wir öffnen Agenten … den Ordner Chat … und hier ist er — der Assistent. Ein Agent ist KI mit Stellenbeschreibung: Anweisungen, ein Modell, Werkzeuge und das Wissen, das er nutzen darf. Einmal gebaut, arbeitet er fürs ganze Team.',
        fr: 'Au fait, qui nous a répondu ? On ouvre Agents… le dossier Chat… et le voici — l’Assistant. Un agent, c’est une IA avec une fiche de poste : instructions, modèle, outils, et les connaissances qu’il peut utiliser. Construit une fois, il sert toute l’équipe.',
      },
    },
    {
      // Where automations come from: the catalog, plus the one that came
      // installed — the signpost into its journal next scene.
      id: 'automations',
      chapterByLocale: {
        en: 'Automations',
        de: 'Automatisierungen',
        fr: 'Automatisations',
      },
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 17_000,
      narration: {
        en: 'Agents can also work while nobody’s watching — that’s automations. We open the catalog: ready-made bundles, like syncing a mailbox or resolving GitHub issues. One of them came with this workspace — task triage — and it’s been running this whole time.',
        de: 'Agenten arbeiten auch, wenn niemand zuschaut — das sind Automatisierungen. Wir öffnen den Katalog: fertige Pakete — ein Postfach synchronisieren oder GitHub-Issues lösen. Eines davon kam mit diesem Arbeitsbereich — die Aufgaben-Triage — und lief die ganze Zeit mit.',
        fr: 'Les agents travaillent aussi quand personne ne regarde — voilà les automatisations. On ouvre le catalogue : des lots prêts à l’emploi — synchroniser une boîte mail, résoudre des issues GitHub. L’un d’eux est déjà installé — le triage des tâches — et il tourne depuis le début.',
      },
    },
    {
      // The proof: the triage journal, plus what the approval gate does —
      // concretely — and the episode-five promise.
      id: 'approvals',
      leadInMs: 2200,
      tailMs: 1700,
      minMs: 19_000,
      narration: {
        en: 'Here’s its journal: one run per row. Each row shows what triggered it and how it ended — this red one failed, and says why. And before a run may send anything out of the workspace, it has to wait for a person’s approval. Episode five opens this page up properly.',
        de: 'Hier ist ihr Journal: ein Lauf pro Zeile — was ihn auslöste, wie er endete. Dieser rote schlug fehl, samt Grund. Und bevor ein Lauf etwas nach draußen schickt, wartet er auf die Freigabe eines Menschen. Episode fünf schaut sich diese Seite gründlich an.',
        fr: 'Voici son journal : une exécution par ligne. Celle en rouge a échoué, la raison est écrite. Et avant d’envoyer quoi que ce soit vers l’extérieur, une exécution attend la validation d’une personne. L’épisode cinq ouvre cette page en détail.',
      },
    },
    {
      // Deep board URL — no clickable path, so the jump cuts under the veil.
      id: 'projects',
      chapterByLocale: { en: 'Projects', de: 'Projekte', fr: 'Projets' },
      chapterTransition: 'cut',
      leadInMs: 2400,
      tailMs: 1600,
      minMs: 16_000,
      narration: {
        en: 'Now, where does the team see all this work? In Projects. This board is the website relaunch: tasks moving from To do to Done, owners on the cards — your people and your agents on the same board.',
        de: 'Und wo sieht dein Team diese Arbeit? In Projekten. Dieses Board ist der Website-Relaunch: Aufgaben wandern von Zu erledigen nach Erledigt — deine Leute und deine Agenten auf demselben Board.',
        fr: 'Et où l’équipe voit-elle ce travail ? Dans les projets. Ce tableau, c’est la refonte du site : des tâches qui avancent de À faire à Terminé — tes collègues et tes agents sur le même tableau.',
      },
    },
    {
      // Deep settings URL — no clickable path, so the jump cuts under the veil.
      id: 'governance',
      chapterByLocale: { en: 'Control', de: 'Kontrolle', fr: 'Contrôle' },
      chapterTransition: 'cut',
      leadInMs: 2400,
      tailMs: 1600,
      minMs: 16_000,
      narration: {
        en: 'Last stop: Settings. You choose which AI providers run your requests — and which region your data stays in. And under Governance, the audit log: every action lands here, with a name and a time on it.',
        de: 'Letzte Station: die Einstellungen. Du wählst, welche KI-Anbieter deine Anfragen ausführen — und in welcher Region deine Daten bleiben. Unter Governance liegt das Audit-Log: Jede Aktion landet dort, mit Name und Uhrzeit.',
        fr: 'Dernier arrêt : les réglages. Tu choisis quels fournisseurs d’IA exécutent tes requêtes — et dans quelle région restent tes données. Sous Gouvernance, le journal d’audit : chaque action y atterrit, avec un nom et une heure.',
      },
    },
    {
      // Recap over the workspace at rest — the verbs the viewer just saw.
      id: 'recap',
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 15_000,
      narration: {
        en: 'And that’s the tour. You asked a question grounded in a real document, found that document in the library, met the agent that answered, and read an automation’s journal. From here, every episode takes one area and goes deep.',
        de: 'Das war die Tour. Du hast eine Frage mit echtem Kontext gestellt, die zitierte Datei im Wissen gefunden, den Agenten dahinter getroffen und das Journal einer Automatisierung gelesen. Ab hier nimmt sich jede Episode einen Bereich vor.',
        fr: 'Et voilà la visite. Tu as posé une question appuyée sur un vrai document, retrouvé le fichier cité, rencontré l’agent qui a répondu, et lu le journal d’une automatisation. Ensuite, chaque épisode prend un domaine et va au fond.',
      },
    },
    {
      // Post-narration room: the card holds ~2s, then the compose fade-out
      // (1.5s) completes inside it — the ending must never feel cut off.
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'Next time: chat, properly — attachments, choosing the right model, and research with sources. Everything you saw today is in the docs, page by page. See you in episode two.',
        de: 'Nächstes Mal: der Chat im Detail — Anhänge, die Modellwahl und Recherche mit Quellen. Alles aus dieser Tour steht in der Doku. Bis zur zweiten Episode.',
        fr: 'La prochaine fois : le chat en profondeur — pièces jointes, choix du modèle et recherche avec sources. Tout ce que tu viens de voir est dans la doc. À bientôt pour l’épisode deux.',
      },
    },
  ],
} as const;
