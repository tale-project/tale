/**
 * Episode 2 — "Chat, in depth", rebuilt on the in-depth arc the Episode 5
 * pilot locked in. The viewer WORKS a real chat session on camera: asks the
 * same topic ungrounded (fluent, generic — the episode's pitfall, read
 * together) and grounded (@-mentioned Q2 review, cited numbers), questions
 * the grounded answer and gets the exact file back, thumbs-up the answer
 * that held (feedback analytics, episode nine), decides an Arena vote on
 * evidence, and builds a canvas brief — then trims it with one plain
 * sentence. Model picker and deep research stay short read-beats.
 *
 * Register (produce-video STORYBOARD.md): tutorial grammar — announce every
 * move before it happens, then observe, then say why. Silence does the
 * pacing: chapter lead-ins 2.2–2.6 s, tail beats after landed points,
 * generous minMs floors.
 *
 * The six on-camera prompts pair 1:1 with `lib/mocks/overrides/
 * docs-replies.ts`: ungrounded + grounded + canvas + Arena exist today;
 * FOLLOWUP_PROMPT and CANVAS_REFINE_PROMPT need the two NEW triplets
 * (delivered with this rewrite) — until those land, their turns would
 * stream the synthetic e2e canned reply.
 */

import type { EpisodeSpec, Locale } from '../../lib/episode';

/** Ungrounded ask — no attachment; pairs with the generic docs reply. */
export const UNGROUNDED_PROMPT: Record<Locale, string> = {
  en: 'How do customers feel about our onboarding?',
  de: 'Wie zufrieden sind unsere Kunden mit dem Onboarding?',
  fr: 'Que pensent nos clients de notre onboarding ?',
};

/**
 * Follow-up turn on the GROUNDED thread — the source check. Pairs with the
 * NEW docs-replies triplet (match clauses: 'which document says that' /
 * 'welches dokument sagt das' / 'quel document le dit'); the reply names the
 * exact seeded file the grounded answer cited (locale-content wowSourceDoc).
 */
export const FOLLOWUP_PROMPT: Record<Locale, string> = {
  en: 'Which document says that?',
  de: 'Welches Dokument sagt das?',
  fr: 'Quel document le dit ?',
};

/** Canvas ask — pairs with the `file_write` tool-scripted docs reply. */
export const CANVAS_PROMPT: Record<Locale, string> = {
  en: 'Turn the onboarding feedback into a one-page brief for the leadership team.',
  de: 'Mach aus dem Onboarding-Feedback ein einseitiges Briefing für die Geschäftsleitung.',
  fr: 'Transforme les retours d’onboarding en une synthèse d’une page pour la direction.',
};

/**
 * Canvas refinement turn — the brief rewritten in place. Pairs with the NEW
 * `file_write` docs-replies triplet (match clauses: 'cut it to three
 * bullets' / 'kürze es auf drei stichpunkte' / 'réduis-la à trois puces');
 * the tool overwrites the SAME file path the first brief landed on.
 */
export const CANVAS_REFINE_PROMPT: Record<Locale, string> = {
  en: 'Cut it to three bullets.',
  de: 'Kürze es auf drei Stichpunkte.',
  fr: 'Réduis-la à trois puces.',
};

/**
 * Arena ask — native per locale; en reuses the seeded launch-checklist entry,
 * de/fr pair with their own byModel entries in docs-replies.ts.
 */
export const ARENA_PROMPT: Record<Locale, string> = {
  en: 'Draft a launch checklist for the website relaunch project',
  de: 'Entwirf eine Launch-Checkliste für den Website-Relaunch.',
  fr: 'Rédige une check-list de lancement pour la refonte du site.',
};

/** The phrase each Arena column's reply carries exactly once — the wait
 * anchor for "both columns finished streaming". */
export const ARENA_DONE_PHRASE: Record<Locale, string> = {
  en: 'launch-blocking ones',
  de: 'blockieren den Launch',
  fr: 'bloquantes pour le lancement',
};

/** The brief's H1 as the canvas mock writes it — rendered only once the
 * canvas pane is actually open on the file, so it is the honest "pane
 * opened" anchor (the pane's rail tab exists even while closed). */
export const CANVAS_BRIEF_HEADING: Record<Locale, string> = {
  en: 'Onboarding — what customers told us in Q2',
  de: 'Onboarding — das Kundenfeedback aus Q2',
  fr: 'Onboarding — ce que les clients nous ont dit au T2',
};

/** A line that exists ONLY in the refined (three-bullet) brief — the honest
 * "the file was rewritten in place" anchor, absent from the first version.
 * Quotes the NEW canvas-refine docs-replies content verbatim. */
export const CANVAS_REFINED_MARKER: Record<Locale, string> = {
  en: 'The three-bullet version for leadership.',
  de: 'Die Drei-Punkte-Fassung für die Geschäftsleitung.',
  fr: 'La version en trois puces pour la direction.',
};

export const EP2_CHAT: EpisodeSpec = {
  id: 'ep2-chat',
  section: 'tutorials',
  titleByLocale: {
    en: 'Chat, in depth',
    de: 'Chat, im Detail',
    fr: 'Le chat, en profondeur',
  },
  episodeLabelByLocale: {
    en: 'Episode 2',
    de: 'Episode 2',
    fr: 'Épisode 2',
  },
  needsKnowledgeDb: true,
  wholeTakeLocales: ['en'],
  voices: {
    en: 'WZlYpi1yf6zJhNWXih74',
    de: 'rKiu7lQ4c5P3az3745s3',
    fr: 'QbsdzCokdlo98elkq4Pc',
  },
  /** The GROUNDED ask typed with the @-mentioned Q2 review attached. */
  heroPromptByLocale: {
    en: 'Based on the Q2 support review, what should we fix first in onboarding?',
    de: 'Was sollten wir laut dem Q2-Support-Bericht im Onboarding zuerst beheben?',
    fr: 'D’après la revue support du T2, que corriger en priorité dans l’onboarding ?',
  },
  scenes: [
    {
      // Cold open over the END STATE: the finished brief on the canvas
      // (written by the warmup). The card lifts BEFORE the voice names it.
      id: 'title',
      leadInMs: 1600,
      minMs: 27_000,
      narration: {
        en: 'Welcome to episode two. Today we slow down and really learn chat: you’ll ask the same question twice and see why one answer is worth more, check a source, put two models head to head — and build this: a one-page brief, written onto the canvas next to the chat. That’s where we’ll end up. We’ll go step by step, starting from an empty chat.',
        de: 'Willkommen zu Episode zwei. Heute nehmen wir uns Zeit für den Chat: Du stellst dieselbe Frage zweimal und siehst, warum eine Antwort mehr wert ist, prüfst eine Quelle, lässt zwei Modelle gegeneinander antreten — und baust das hier: ein einseitiges Briefing, direkt im Canvas neben dem Chat. Genau hier enden wir. Wir gehen Schritt für Schritt vor — und starten mit einem leeren Chat.',
        fr: 'Bienvenue dans l’épisode deux. Aujourd’hui, on prend le temps avec le chat : tu vas poser deux fois la même question et voir pourquoi une réponse vaut plus que l’autre, vérifier une source, faire concourir deux modèles — et construire ceci : une synthèse d’une page, écrite dans le canevas à côté du chat. C’est ici qu’on finit. On avance étape par étape — en partant d’un chat vide.',
      },
    },
    {
      // The composer: three choices before any typing (cut to /chat home).
      id: 'context',
      chapterByLocale: {
        en: 'The composer',
        de: 'Die Eingabezeile',
        fr: 'Le composeur',
      },
      chapterTransition: 'cut',
      leadInMs: 2400,
      tailMs: 1600,
      minMs: 20_000,
      narration: {
        en: 'Here’s where every chat starts. Before we type anything, look at the bottom bar — it holds three choices. Which agent answers, which model runs, and what context you attach. Those three decide what kind of answer comes back. So let’s put them to work.',
        de: 'Hier beginnt jeder Chat. Bevor wir etwas tippen, schau auf die Leiste unten: Dort triffst du drei Entscheidungen. Welcher Agent antwortet, welches Modell rechnet, und welcher Kontext mitkommt. Diese drei bestimmen, welche Antwort zurückkommt — also setzen wir sie ein.',
        fr: 'Voici où chaque chat commence. Avant de taper quoi que ce soit, regarde la barre du bas : trois choix s’y font. Quel agent répond, quel modèle tourne, quel contexte accompagne la question. Ces trois choix décident de la réponse qui revient — alors mettons-les au travail.',
      },
    },
    {
      // Task block 1 — grounding. The ungrounded ask, typed and sent live.
      id: 'ask-ungrounded',
      chapterByLocale: { en: 'Grounding', de: 'Verankerung', fr: 'Ancrage' },
      leadInMs: 2200,
      tailMs: 1500,
      minMs: 17_000,
      narration: {
        en: 'First, an experiment. We ask about our own customers — without giving the model anything to read. We send it… and watch the answer stream in. Sounds good, doesn’t it? Confident, well structured, reasonable.',
        de: 'Zuerst ein Experiment. Wir fragen nach unseren eigenen Kunden — ohne dem Modell etwas zum Lesen zu geben. Absenden … und sieh der Antwort beim Ankommen zu. Klingt gut, oder? Selbstsicher, sauber gegliedert, vernünftig.',
        fr: 'D’abord, une expérience. On pose une question sur nos propres clients — sans rien donner à lire au modèle. On envoie… et regarde la réponse arriver. Ça sonne bien, non ? Assurée, bien structurée, raisonnable.',
      },
    },
    {
      // The pitfall, made explicit: the fluent answer read together, slowly.
      id: 'pitfall',
      leadInMs: 1000,
      tailMs: 1700,
      minMs: 18_000,
      narration: {
        en: 'Now read it with me — because this is the trap. Not one number in there comes from your workspace. The model has never seen your customers, so it fills the gap with patterns from its training data. It sounds right — and it’s guessing.',
        de: 'Jetzt lies sie mit mir — denn genau das ist die Falle. Keine einzige Zahl darin stammt aus deinem Arbeitsbereich. Das Modell hat deine Kunden nie gesehen, also füllt es die Lücke mit Mustern aus seinen Trainingsdaten. Es klingt richtig — und es rät.',
        fr: 'Maintenant, lis-la avec moi — c’est exactement le piège. Pas un seul chiffre là-dedans ne vient de ton espace de travail. Le modèle n’a jamais vu tes clients, alors il comble le vide avec les motifs de ses données d’entraînement. Ça sonne juste — et ça devine.',
      },
    },
    {
      // The grounded re-ask: fresh chat, @-mention the Q2 review, same topic.
      id: 'ask-grounded',
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 17_000,
      narration: {
        en: 'Let’s fix that. Same topic, fresh chat — but this time we type an at-sign first and attach the Q2 support review. The document now rides along with the question… and we send it.',
        de: 'Das beheben wir. Gleiches Thema, neuer Chat — aber diesmal tippen wir zuerst ein @-Zeichen und hängen den Q2-Support-Bericht an. Das Dokument reist jetzt mit der Frage mit … und wir senden ab.',
        fr: 'Corrigeons ça. Même sujet, nouveau chat — mais cette fois, on tape d’abord une arobase et on attache la revue support du T2. Le document part maintenant avec la question… et on envoie.',
      },
    },
    {
      // The grounded answer, observed calmly: the number, the named source.
      id: 'grounded-answer',
      leadInMs: 1000,
      tailMs: 1700,
      minMs: 18_000,
      narration: {
        en: 'Look at the difference. Webhook questions doubled after the April release — that’s your number, from your review. The answer names its sources and ends with one concrete fix. Same model as before. The only thing we changed is what it could read.',
        de: 'Sieh dir den Unterschied an. Webhook-Fragen haben sich nach dem April-Release verdoppelt — das ist deine Zahl, aus deinem Bericht. Die Antwort nennt ihre Quellen und endet mit einem konkreten Fix. Gleiches Modell wie eben. Geändert haben wir nur, was es lesen konnte.',
        fr: 'Regarde la différence. Les questions webhooks ont doublé depuis la version d’avril — c’est ton chiffre, tiré de ta revue. La réponse nomme ses sources et finit sur un correctif concret. Même modèle qu’avant. On a seulement changé ce qu’il pouvait lire.',
      },
    },
    {
      // Task block 2 — the source check: a follow-up turn, same thread.
      id: 'follow-up',
      chapterByLocale: { en: 'Sources', de: 'Quellen', fr: 'Sources' },
      leadInMs: 2200,
      tailMs: 1600,
      minMs: 19_000,
      narration: {
        en: 'Here’s what a grounded answer unlocks: you can question it. In the same thread, we ask — which document says that? And the reply names the exact file, the Q2 support review. When a claim looks off later, this is the question to ask.',
        de: 'Und eine verankerte Antwort kannst du befragen. Im selben Thread fragen wir: Welches Dokument sagt das? Die Antwort nennt die genaue Datei — den Q2-Support-Bericht. Wenn dir später eine Aussage seltsam vorkommt, ist das deine erste Rückfrage.',
        fr: 'Et une réponse ancrée, tu peux l’interroger. Dans le même fil, on demande : quel document le dit ? La réponse nomme le fichier exact — la revue support du T2. Si une affirmation te paraît étrange plus tard, c’est la première question à poser.',
      },
    },
    {
      // Verify beat: the thumbs-up, on camera — where the rating goes.
      id: 'thumbs-up',
      leadInMs: 1000,
      tailMs: 1600,
      minMs: 16_000,
      narration: {
        en: 'One more habit while we’re here. This answer held up — so let’s say so. We click the thumbs-up under it. That rating lands in your workspace’s feedback analytics, and episode nine reads them. It’s one click — and your team learns which answers to trust.',
        de: 'Noch eine Gewohnheit, wo wir schon hier sind. Diese Antwort hat gehalten — also sagen wir das. Ein Klick auf den Daumen nach oben. Die Bewertung landet in den Feedback-Auswertungen deines Arbeitsbereichs, und Episode neun liest sie. Ein Klick — und dein Team lernt, welchen Antworten es trauen kann.',
        fr: 'Une habitude de plus, tant qu’on y est. Cette réponse a tenu — alors disons-le. Un clic sur le pouce levé. La note atterrit dans les statistiques de feedback de ton espace de travail, et l’épisode neuf les lit. Un clic — et ton équipe apprend quelles réponses méritent confiance.',
      },
    },
    {
      // Task block 3 opener — the model decision: Auto vs pinning.
      id: 'model-choice',
      chapterByLocale: { en: 'Models', de: 'Modelle', fr: 'Modèles' },
      leadInMs: 2300,
      tailMs: 1500,
      minMs: 17_000,
      narration: {
        en: 'Second decision: the model. Let’s open the picker. Auto is the default — it routes each request to a sensible model, and for everyday questions that’s the right call. Pin a specific model when the task is unusual. But how do you pick one? Let’s get evidence.',
        de: 'Zweite Entscheidung: das Modell. Öffnen wir die Auswahl. Auto ist der Standard — es wählt für jede Anfrage ein passendes Modell, und für Alltagsfragen ist das die richtige Wahl. Ein bestimmtes Modell fixierst du, wenn die Aufgabe ungewöhnlich ist. Aber woher weißt du, welches? Holen wir uns Belege.',
        fr: 'Deuxième décision : le modèle. Ouvrons le sélecteur. Auto est le réglage par défaut — il route chaque demande vers un modèle raisonnable, et pour les questions courantes, c’est le bon choix. Tu fixes un modèle précis quand la tâche sort de l’ordinaire. Mais lequel ? Allons chercher des preuves.',
      },
    },
    {
      // Arena: plus menu → Arena Mode → one prompt, two columns.
      id: 'arena',
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 24_000,
      narration: {
        en: 'For evidence, chat has Arena mode. We start a fresh chat, open the plus menu… and switch it on. One prompt now goes to two models, side by side. We ask for a launch checklist — and both columns answer the same brief.',
        de: 'Für Belege gibt es den Arena-Modus. Neuer Chat, das Plus-Menü … und einschalten. Ein Prompt geht jetzt an zwei Modelle, Seite an Seite. Wir bitten um eine Launch-Checkliste — und beide Spalten beantworten denselben Auftrag.',
        fr: 'Pour les preuves, il y a le mode Arène. Nouveau chat, le menu plus… et on l’active. Un prompt part maintenant vers deux modèles, côte à côte. On demande une check-list de lancement — et les deux colonnes répondent au même brief.',
      },
    },
    {
      // The verdict: read both columns, name the difference, vote B.
      id: 'arena-verdict',
      leadInMs: 1000,
      tailMs: 1700,
      minMs: 29_000,
      narration: {
        en: 'Take your time and compare. The left one is short and tidy — five steps, done. The right one groups the work by phase and flags two risks the left one skipped: forty unmapped blog URLs, and no agreed bar for the accessibility sweep. For a quick list, A would do. We’re running a launch — so we vote B. The verdict feeds the same analytics as your thumbs-up.',
        de: 'Nimm dir Zeit zum Vergleichen. Links: kurz und aufgeräumt — fünf Schritte, fertig. Rechts: nach Phasen gruppiert, mit zwei Risiken, die links fehlen — vierzig Blog-URLs ohne Entscheidung und keine vereinbarte Schweregrenze für den Accessibility-Durchgang. Für eine schnelle Liste reicht A. Wir launchen eine Website — also stimmen wir für B. Das Urteil fließt in dieselben Auswertungen wie dein Daumen von eben.',
        fr: 'Prends le temps de comparer. À gauche : court et net — cinq étapes, terminé. À droite : le travail groupé par phase, avec deux risques absents à gauche — quarante URL de blog sans décision, et aucun seuil convenu pour la passe accessibilité. Pour une liste rapide, A suffit. On lance un site — alors on vote B. Le verdict rejoint les mêmes statistiques que ton pouce levé.',
      },
    },
    {
      // Task block 4 — the canvas: a deliverable lands as a file.
      id: 'canvas',
      chapterByLocale: { en: 'Canvas', de: 'Canvas', fr: 'Canevas' },
      leadInMs: 2300,
      tailMs: 1600,
      // Rehearsal: the canvas open + file stream + Preview switch overran a
      // 22 s floor by up to 1.7 s (en) — the writing animation owns the pace.
      minMs: 25_000,
      narration: {
        en: 'New task: a big deliverable. We ask for a one-page brief for the leadership team — the kind of thing you never want as a wall of chat text. Send… and watch the right side: the canvas opens, and the brief lands as a file. We switch to Preview — and it reads like a page.',
        de: 'Neue Aufgabe: ein großes Ergebnis. Wir bitten um ein einseitiges Briefing für die Geschäftsleitung — so etwas willst du nie als Textwand im Chat. Absenden … und schau nach rechts: Das Canvas öffnet sich, und das Briefing landet als Datei. Wir schalten auf Vorschau — und es liest sich wie eine Seite.',
        fr: 'Nouvelle tâche : un gros livrable. On demande une synthèse d’une page pour la direction — le genre de chose que tu ne veux jamais en mur de texte. On envoie… et regarde à droite : le canevas s’ouvre, et la synthèse arrive comme un fichier. On passe en Aperçu — et ça se lit comme une page.',
      },
    },
    {
      // The refinement: one plain sentence rewrites the file in place.
      id: 'canvas-refine',
      leadInMs: 1000,
      tailMs: 1700,
      minMs: 20_000,
      narration: {
        en: 'And a canvas file is a working document. Leadership wants it shorter? We say so, in plain words: cut it to three bullets. The agent rewrites the file in place — same page, three bullets. Nothing to copy anywhere; you refine the document right where it is.',
        de: 'Und eine Canvas-Datei ist ein Arbeitsdokument. Die Geschäftsleitung will es kürzer? Dann sagen wir das im Chat: Kürze es auf drei Stichpunkte. Der Agent schreibt die Datei an Ort und Stelle um — gleiche Seite, drei Punkte. Kein Kopieren in ein anderes Programm; du verfeinerst das Dokument da, wo es liegt.',
        fr: 'Et un fichier du canevas est un document de travail. La direction la veut plus courte ? On le dit dans le chat : réduis-la à trois puces. L’agent réécrit le fichier sur place — même page, trois puces. Rien à copier ailleurs ; tu retouches le document là où il est.',
      },
    },
    {
      // Deep research, shown honestly: the Modes entry, the Researcher.
      id: 'research',
      chapterByLocale: { en: 'Research', de: 'Recherche', fr: 'Recherche' },
      leadInMs: 2300,
      tailMs: 1600,
      minMs: 17_000,
      narration: {
        en: 'One more to point out: deep research. Open the plus menu, and there it is — Deep research. Turn it on and the chat hands off to the Researcher agent: it plans its own searches, reads the open web, and returns a report with named sources. It needs a search connector, so we’ll give it a full episode of its own later. Today’s rule — check the source — applies there too.',
        de: 'Noch eines zum Zeigen: die Tiefenrecherche. Öffne das Plus-Menü — und da ist sie, Deep research. Schaltest du sie ein, übergibt der Chat an den Rechercheur-Agenten: Er plant seine Suchen selbst, liest im offenen Web und liefert einen Bericht mit benannten Quellen. Er braucht einen Such-Connector, deshalb bekommt er später eine eigene Episode. Die Regel von heute — prüf die Quelle — gilt auch dort.',
        fr: 'Encore un à signaler : la recherche approfondie. Ouvre le menu plus — et la voilà, Deep research. Active-la et le chat passe la main à l’agent Chercheur : il planifie ses recherches, lit le web ouvert et rend un rapport avec ses sources nommées. Il lui faut un connecteur de recherche, alors on lui consacrera un épisode entier plus tard. La règle du jour — vérifie la source — vaut là aussi.',
      },
    },
    {
      // Recap over a fresh chat at rest: the verbs, the docs page, ep3 next.
      id: 'recap',
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 18_000,
      narration: {
        en: 'And that’s chat, used well. You asked the same question ungrounded and grounded, checked a source, rated an answer, judged an Arena — and turned feedback into a brief on the canvas, then cut it down with one sentence. The chat guide in the docs covers all of it, keyboard shortcuts included.',
        de: 'Das war der Chat, gut genutzt. Du hast dieselbe Frage ohne und mit Verankerung gestellt, eine Quelle geprüft, eine Antwort bewertet, eine Arena entschieden — und aus Feedback ein Briefing im Canvas gemacht, dann mit einem Satz gekürzt. Der Chat-Leitfaden in der Doku vertieft alles, Tastaturkürzel inklusive.',
        fr: 'Voilà le chat, bien utilisé. Tu as posé la même question sans ancrage puis avec, vérifié une source, noté une réponse, tranché une Arène — et transformé du feedback en synthèse dans le canevas, puis réduit le tout en une phrase. Le guide du chat dans la doc détaille tout, raccourcis clavier compris.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'Next time: Knowledge — where the documents behind your grounded answers live. You’ll index one yourself and watch the answers change. See you in episode three.',
        de: 'Nächstes Mal: Wissen — da liegen die Dokumente hinter deinen verankerten Antworten. Du indexierst selbst eines und siehst, wie sich Antworten ändern. Bis zur dritten Episode.',
        fr: 'La prochaine fois : les connaissances — c’est là que se trouvent les documents derrière tes réponses ancrées. Tu en indexeras un toi-même et tu verras les réponses changer. À bientôt pour l’épisode trois.',
      },
    },
  ],
} as const;
