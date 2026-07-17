/**
 * Episode 4 — "Your first agent". An agent built end to end ON CAMERA: name,
 * instructions, knowledge scope, tools, model — then made visible and tested
 * live in chat. The AI-literacy beat is the trust boundary: every tool
 * widens what the agent can DO, so the smallest agent that does the job is
 * the safest one. The created agent and its test thread are removed off
 * camera (`cleanupAgentNames` / `cleanupThreadIds` notes).
 *
 * The typed instructions and the test reply pair deliberately: the mandate
 * says "friendly, concrete, hand billing disputes to a human", and the
 * scripted reply visibly obeys it — instructions shaping behaviour, on
 * screen.
 */

import type { EpisodeSpec, Locale } from '../../lib/episode';

/** The created agent's display name — typed on camera, per locale. */
export const AGENT_DISPLAY_NAME: Record<Locale, string> = {
  en: 'Support Coach',
  de: 'Support-Coach',
  fr: 'Coach Support',
};

/** The slug typed into the create dialog (ASCII, same everywhere). */
export const AGENT_SLUG = 'support-coach';

/** The mandate typed into System instructions, native per locale. */
export const AGENT_INSTRUCTIONS: Record<Locale, string> = {
  en: 'You help our support team draft replies. Be friendly and concrete, keep answers under six sentences, and hand any billing dispute to a human.',
  de: 'Du hilfst unserem Support-Team beim Formulieren von Antworten. Sei freundlich und konkret, bleib unter sechs Sätzen und übergib Rechnungsstreitigkeiten an einen Menschen.',
  fr: 'Tu aides notre équipe support à rédiger ses réponses. Sois chaleureux et concret, reste sous six phrases, et confie tout litige de facturation à un humain.',
};

export const EP4_AGENT: EpisodeSpec = {
  id: 'ep4-agent',
  section: 'tutorials',
  titleByLocale: {
    en: 'Your first agent',
    de: 'Dein erster Agent',
    fr: 'Ton premier agent',
  },
  episodeLabelByLocale: {
    en: 'Episode 4',
    de: 'Episode 4',
    fr: 'Épisode 4',
  },
  needsKnowledgeDb: true,
  wholeTakeLocales: ['en'],
  voices: {
    en: 'WZlYpi1yf6zJhNWXih74',
    de: 'rKiu7lQ4c5P3az3745s3',
    fr: 'QbsdzCokdlo98elkq4Pc',
  },
  /** The live test ask — pairs with its docs-reply. */
  heroPromptByLocale: {
    en: 'How should I reply to a customer asking for an invoice copy?',
    de: 'Wie antworte ich einem Kunden, der eine Rechnungskopie möchte?',
    fr: 'Comment répondre à un client qui demande une copie de facture ?',
  },
  scenes: [
    {
      id: 'title',
      leadInMs: 1200,
      narration: {
        en: 'Episode three filled the library. Now we hire the librarian. In this episode: your first agent, built end to end — and why the smallest agent is usually the best one.',
        de: 'Episode drei hat die Bibliothek gefüllt. Jetzt stellen wir den Bibliothekar ein. In dieser Episode: dein erster Agent, von Anfang bis Ende — und warum der kleinste Agent meist der beste ist.',
        fr: 'L’épisode trois a rempli la bibliothèque. Maintenant, on embauche le bibliothécaire. Dans cet épisode : ton premier agent, construit de bout en bout — et pourquoi le plus petit agent est souvent le meilleur.',
      },
    },
    {
      id: 'agents-list',
      leadInMs: 900,
      narration: {
        en: 'Agents live here. You met the built-in ones in episode one — the Assistant, the Researcher. Today we add our own: a coach that helps the support team draft replies.',
        de: 'Agenten wohnen hier. Die eingebauten kennst du aus Episode eins — den Assistenten, den Rechercheur. Heute bauen wir einen eigenen: einen Coach, der dem Support-Team beim Antworten hilft.',
        fr: 'Les agents vivent ici. Tu as croisé les agents intégrés dans l’épisode un — l’Assistant, le Chercheur. Aujourd’hui on ajoute le nôtre : un coach qui aide l’équipe support à rédiger.',
      },
    },
    {
      id: 'create',
      chapterByLocale: { en: 'Create', de: 'Anlegen', fr: 'Créer' },
      // Menu + dialog + two typed fields + continue + editor mount.
      minMs: 17_000,
      narration: {
        en: 'An agent starts with a name and an identity. Create agent, blank, a technical name… a display name… and continue. That is the whole ceremony — the real work is the four decisions ahead.',
        de: 'Ein Agent beginnt mit einem Namen und einer Identität. Agent anlegen, leer, ein technischer Name … ein Anzeigename … und weiter. Das war die ganze Zeremonie — die echte Arbeit sind die vier Entscheidungen danach.',
        fr: 'Un agent commence par un nom et une identité. Créer un agent, vierge, un nom technique… un nom d’affichage… et continuer. Voilà toute la cérémonie — le vrai travail, ce sont les quatre décisions qui suivent.',
      },
    },
    {
      id: 'instructions',
      chapterByLocale: {
        en: 'Instructions',
        de: 'Anweisungen',
        fr: 'Instructions',
      },
      // Nav to the editor view + typing the full mandate.
      minMs: 17_000,
      narration: {
        en: 'Decision one: the instructions — the job description. Tone, duties, and the line it must not cross. Ours says: be friendly and concrete, and hand billing disputes to a human. Write it like you would brief a new colleague.',
        de: 'Entscheidung eins: die Anweisungen — die Stellenbeschreibung. Ton, Aufgaben und die Linie, die nicht überschritten wird. Unsere sagt: freundlich und konkret sein, Rechnungsstreitigkeiten an einen Menschen übergeben. Schreib sie, wie du eine neue Kollegin einarbeiten würdest.',
        fr: 'Décision un : les instructions — la fiche de poste. Le ton, les tâches, et la ligne à ne pas franchir. La nôtre dit : chaleureux et concret, et tout litige de facturation part chez un humain. Écris-les comme tu brieferais une nouvelle collègue.',
      },
    },
    {
      id: 'knowledge',
      narration: {
        en: 'Decision two: what it may read. The knowledge scope from last episode applies per agent — give the coach the support documents and nothing more. The smallest library that does the job.',
        de: 'Entscheidung zwei: was er lesen darf. Der Wissensbereich aus der letzten Episode gilt pro Agent — gib dem Coach die Support-Dokumente und nicht mehr. Die kleinste Bibliothek, die den Job erledigt.',
        fr: 'Décision deux : ce qu’il peut lire. Le périmètre de connaissances du dernier épisode s’applique par agent — donne au coach les documents support et rien de plus. La plus petite bibliothèque qui fait le travail.',
      },
    },
    {
      id: 'tools',
      chapterByLocale: { en: 'Tools', de: 'Werkzeuge', fr: 'Outils' },
      minMs: 12_000,
      narration: {
        en: 'Decision three is the one to respect: tools. Every box you tick widens what this agent can DO — search the web, write files, run code, call your integrations. Capability is also exposure. Start with none, add each tool the day the job demands it.',
        de: 'Entscheidung drei verdient Respekt: die Werkzeuge. Jedes Häkchen erweitert, was dieser Agent TUN kann — das Web durchsuchen, Dateien schreiben, Code ausführen, deine Integrationen aufrufen. Fähigkeit ist auch Angriffsfläche. Starte ohne, und ergänze jedes Werkzeug an dem Tag, an dem der Job es verlangt.',
        fr: 'La décision trois mérite le respect : les outils. Chaque case cochée élargit ce que cet agent peut FAIRE — chercher sur le web, écrire des fichiers, exécuter du code, appeler tes intégrations. La capacité, c’est aussi de l’exposition. Commence sans rien, ajoute chaque outil le jour où le travail l’exige.',
      },
    },
    {
      id: 'model',
      narration: {
        en: 'Decision four: the engine. Pick a model, add a fallback for busy days — or leave it on the workspace default. For a drafting coach, the default is exactly right.',
        de: 'Entscheidung vier: der Motor. Wähl ein Modell, leg einen Fallback für volle Tage fest — oder bleib beim Standard des Arbeitsbereichs. Für einen Formulierungs-Coach ist der Standard genau richtig.',
        fr: 'Décision quatre : le moteur. Choisis un modèle, ajoute un secours pour les jours chargés — ou garde le réglage par défaut de l’espace de travail. Pour un coach de rédaction, le défaut est exactement ce qu’il faut.',
      },
    },
    {
      id: 'publish',
      chapterByLocale: { en: 'Test it', de: 'Testen', fr: 'À l’essai' },
      // General view + toggle + rail to chat + picker + typed ask + stream.
      minMs: 22_000,
      narration: {
        en: 'Make it visible in chat, and the whole team has a new colleague. We test it right away: a customer wants an invoice copy… and look at the answer. Friendly, concrete — and it hands the billing dispute to a human, exactly as instructed.',
        de: 'Mach ihn im Chat sichtbar, und dein Team hat eine neue Kollegin. Wir testen sofort: ein Kunde möchte eine Rechnungskopie … und schau dir die Antwort an. Freundlich, konkret — und Rechnungsstreit geht an einen Menschen, genau wie angewiesen.',
        fr: 'Rends-le visible dans le chat, et toute l’équipe a un nouveau collègue. On le teste tout de suite : un client veut une copie de facture… et regarde la réponse. Chaleureuse, concrète — et le litige de facturation part chez un humain, exactement comme demandé.',
      },
    },
    {
      id: 'iterate',
      narration: {
        en: 'An agent is a draft you refine, not a monument. Instructions are cheap to change, and the history keeps every version — improve boldly, roll back freely.',
        de: 'Ein Agent ist ein Entwurf, den du verfeinerst — kein Denkmal. Anweisungen sind billig zu ändern, und die Historie behält jede Version — verbessere mutig, roll ruhig zurück.',
        fr: 'Un agent est un brouillon qu’on affine, pas un monument. Les instructions ne coûtent rien à changer, et l’historique garde chaque version — améliore sans peur, reviens en arrière sans regret.',
      },
    },
    {
      id: 'recap',
      narration: {
        en: 'Name, instructions, knowledge, tools, model — a colleague you designed, scoped as small as the job allows. Next episode: automations — agents that act on schedules and events, with people approving the risky steps.',
        de: 'Name, Anweisungen, Wissen, Werkzeuge, Modell — eine Kollegin nach deinem Entwurf, so klein geschnitten wie der Job erlaubt. Nächste Episode: Automatisierungen — Agenten, die auf Zeitpläne und Ereignisse reagieren, während Menschen die riskanten Schritte freigeben.',
        fr: 'Nom, instructions, connaissances, outils, modèle — un collègue que tu as conçu, taillé au plus juste. Prochain épisode : les automatisations — des agents qui agissent sur planning et événements, avec des humains qui valident les étapes risquées.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'The agents section of the documentation walks every decision you just made. See you in episode five.',
        de: 'Der Agenten-Bereich der Dokumentation führt durch jede Entscheidung von eben. Bis zur fünften Episode.',
        fr: 'La section Agents de la documentation reprend chaque décision que tu viens de prendre. À bientôt pour l’épisode cinq.',
      },
    },
  ],
} as const;
