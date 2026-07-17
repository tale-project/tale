/**
 * Episode 2 — "Chat, in depth". The deep dive Episode 1's recap promised:
 * attachments, model choice, and research. One surface (the chat), one core
 * AI-literacy beat played as a two-act contrast — the SAME topic asked
 * ungrounded (fluent, confident, generic) and grounded (numbers, named
 * sources) — then evidence-based model choice (Arena), the canvas workbench,
 * and an honest look at deep research (shown, not faked: a live run cannot be
 * scripted deterministically).
 *
 * Narration doctrine as Episode 1: docs voice, native per locale, spoken UI
 * vocabulary from the shipped catalog (de "Rechercheur", fr "Chercheur",
 * fr "canevas", de/en "Canvas", "Arena-Modus"/"Mode Arène"). The four
 * on-camera prompts pair 1:1 with `lib/mocks/overrides/docs-replies.ts`:
 * ungrounded + grounded (this file's constants), the canvas brief, and the
 * Arena launch-checklist prompt whose per-model variants ship `byModel`.
 */

import type { EpisodeSpec, Locale } from '../../lib/episode';

/** Ungrounded ask — no attachment; pairs with the generic docs reply. */
export const UNGROUNDED_PROMPT: Record<Locale, string> = {
  en: 'How do customers feel about our onboarding?',
  de: 'Wie zufrieden sind unsere Kunden mit dem Onboarding?',
  fr: 'Que pensent nos clients de notre onboarding ?',
};

/** Canvas ask — pairs with the `file_write` tool-scripted docs reply. */
export const CANVAS_PROMPT: Record<Locale, string> = {
  en: 'Turn the onboarding feedback into a one-page brief for the leadership team.',
  de: 'Mach aus dem Onboarding-Feedback ein einseitiges Briefing für die Geschäftsleitung.',
  fr: 'Transforme les retours d’onboarding en une synthèse d’une page pour la direction.',
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
      id: 'title',
      leadInMs: 1200,
      narration: {
        en: 'Chat is the room where your team meets the models. In this episode: how to ask well, what to attach, how to choose a model — and how to tell a solid answer from a fluent one.',
        de: 'Der Chat ist der Raum, in dem dein Team den Modellen begegnet. In dieser Episode: gut fragen, Kontext anhängen, das Modell wählen — und eine belastbare Antwort von einer bloß flüssigen unterscheiden.',
        fr: 'Le chat, c’est la pièce où ton équipe rencontre les modèles. Dans cet épisode : bien demander, quoi attacher, comment choisir un modèle — et distinguer une réponse solide d’une réponse simplement fluide.',
      },
    },
    {
      id: 'composer',
      leadInMs: 900,
      narration: {
        en: 'A chat starts in the composer, and the composer is more than a text box. You choose which agent answers, which model runs, and what context rides along. Those three choices shape every answer you will get.',
        de: 'Ein Chat beginnt im Eingabefeld — und das kann mehr als Text. Du wählst, welcher Agent antwortet, welches Modell rechnet und welcher Kontext mitfährt. Diese drei Entscheidungen prägen jede Antwort.',
        fr: 'Un chat commence dans le composeur — et c’est plus qu’une zone de texte. Tu choisis quel agent répond, quel modèle tourne et quel contexte accompagne la question. Ces trois choix façonnent chaque réponse.',
      },
    },
    {
      id: 'ask-ungrounded',
      chapterByLocale: { en: 'Grounding', de: 'Verankerung', fr: 'Ancrage' },
      // Typing the prompt + send + the generic reply streaming to the end.
      minMs: 15_000,
      narration: {
        en: 'Watch what happens without context. We ask how customers feel about our onboarding… and the model answers — fluent, confident, and completely generic. It has never seen your customers. It is filling the gap with patterns from its training data.',
        de: 'Schau, was ohne Kontext passiert. Wir fragen, wie zufrieden unsere Kunden mit dem Onboarding sind … und das Modell antwortet — flüssig, selbstsicher und völlig generisch. Es hat deine Kunden nie gesehen. Es füllt die Lücke mit Mustern aus seinen Trainingsdaten.',
        fr: 'Regarde ce qui se passe sans contexte. On demande ce que pensent nos clients de notre onboarding… et le modèle répond — fluide, assuré, et parfaitement générique. Il n’a jamais vu tes clients. Il comble le vide avec les motifs de ses données d’entraînement.',
      },
    },
    {
      id: 'attach-grounded',
      // Mention picker + longer prompt + reasoning + grounded reply stream.
      minMs: 17_000,
      narration: {
        en: 'Now the same topic, grounded. We attach the Q2 support review… and ask what to fix first. The answer changes character: your numbers, your documents, named sources you can open and check.',
        de: 'Jetzt dasselbe Thema, verankert. Wir hängen den Q2-Support-Bericht an … und fragen, was zuerst zu beheben ist. Die Antwort wechselt den Charakter: deine Zahlen, deine Dokumente, benannte Quellen zum Nachprüfen.',
        fr: 'Maintenant le même sujet, ancré. On attache la revue support du T2… et on demande quoi corriger en priorité. La réponse change de nature : tes chiffres, tes documents, des sources nommées que tu peux ouvrir et vérifier.',
      },
    },
    {
      id: 'grounding-lesson',
      // Calm scene: the camera holds on the grounded answer. Stillness is the
      // point — no choreography beyond a slow source hover.
      narration: {
        en: 'This is the one habit that changes everything about working with AI. Same model, same topic — the context decides whether you get plausible words or your own facts. A fluent answer is not evidence. Sources are. When the answer matters, ground it.',
        de: 'Das ist die eine Gewohnheit, die die Arbeit mit KI verändert. Gleiches Modell, gleiches Thema — der Kontext entscheidet, ob du plausible Worte bekommst oder deine eigenen Fakten. Eine flüssige Antwort ist kein Beleg. Quellen sind es. Wenn es darauf ankommt: verankern.',
        fr: 'C’est l’habitude qui change tout dans le travail avec l’IA. Même modèle, même sujet — le contexte décide si tu reçois des mots plausibles ou tes propres faits. Une réponse fluide n’est pas une preuve. Les sources, oui. Quand la réponse compte : ancre-la.',
      },
    },
    {
      id: 'model-choice',
      chapterByLocale: { en: 'Models', de: 'Modelle', fr: 'Modèles' },
      // Opening the picker, an unhurried scan over the catalog, close.
      minMs: 10_000,
      narration: {
        en: 'The model picker is the second decision. Models differ — in speed, in cost, in how deeply they reason. Auto lets Tale route each request to a sensible default, and for most work that is the right call. But you can pin any model your workspace allows.',
        de: 'Die Modellwahl ist die zweite Entscheidung. Modelle unterscheiden sich — in Tempo, Kosten und Denktiefe. Mit Auto wählt Tale für jede Anfrage einen vernünftigen Standard, und meistens ist das die richtige Wahl. Du kannst aber jedes freigegebene Modell festlegen.',
        fr: 'Le choix du modèle est la deuxième décision. Les modèles diffèrent — en vitesse, en coût, en profondeur de raisonnement. Avec Auto, Tale route chaque demande vers un choix raisonnable — le bon réglage la plupart du temps. Mais tu peux fixer n’importe quel modèle autorisé.',
      },
    },
    {
      id: 'arena',
      // Plus menu → Arena → prompt → two columns stream → verdict. The
      // longest choreography of the episode.
      minMs: 24_000,
      narration: {
        en: 'And when you want evidence instead of opinions, run an Arena. One prompt, two models, side by side. Watch them answer the same brief… then call the winner. Your verdicts flow into the workspace analytics — over time, model choice becomes a measured decision, not a taste.',
        de: 'Und wenn du Belege statt Meinungen willst: starte eine Arena. Ein Prompt, zwei Modelle, Seite an Seite. Sieh zu, wie beide denselben Auftrag beantworten … und küre dann den Sieger. Deine Urteile fließen in die Auswertungen des Arbeitsbereichs — Modellwahl wird so mit der Zeit eine gemessene Entscheidung, kein Bauchgefühl.',
        fr: 'Et quand tu veux des preuves plutôt que des avis : lance une Arène. Un prompt, deux modèles, côte à côte. Regarde-les répondre au même brief… puis désigne le gagnant. Tes verdicts alimentent les statistiques de l’espace de travail — le choix du modèle devient une décision mesurée, pas une affaire de goût.',
      },
    },
    {
      id: 'canvas',
      chapterByLocale: { en: 'Canvas', de: 'Canvas', fr: 'Canevas' },
      // New thread + typing + reasoning + the file landing + pane opening.
      minMs: 19_000,
      narration: {
        en: 'Big deliverables get their own workbench. Ask for a document — a brief, a report, a page — and the canvas opens next to the chat. The result lands as a file you can read, refine, and share. Not a wall of chat text you copy-paste out of.',
        de: 'Große Ergebnisse bekommen eine eigene Werkbank. Bitte um ein Dokument — ein Briefing, einen Bericht, eine Seite — und neben dem Chat öffnet sich das Canvas. Das Ergebnis liegt als Datei vor: lesen, verfeinern, teilen. Keine Textwand zum Herauskopieren.',
        fr: 'Les gros livrables ont leur établi. Demande un document — une synthèse, un rapport, une page — et le canevas s’ouvre à côté du chat. Le résultat arrive comme un fichier : à lire, à retoucher, à partager. Pas un mur de texte à copier-coller.',
      },
    },
    {
      id: 'research',
      chapterByLocale: { en: 'Research', de: 'Recherche', fr: 'Recherche' },
      // Agent picker open, Researcher selected, the deep-research chip shown.
      minMs: 9_000,
      narration: {
        en: 'One more thing lives here: deep research. The Researcher agent plans its own searches, reads what it finds on the open web, and returns a report with named sources. The grounding rule you just learned — it extends all the way to the internet.',
        de: 'Eines wohnt noch hier: die Tiefenrecherche. Der Agent Rechercheur plant seine Suchen selbst, liest, was er im offenen Web findet, und liefert einen Bericht mit benannten Quellen. Die Verankerungs-Regel von eben — sie reicht bis ins Internet.',
        fr: 'Une chose encore habite ici : la recherche approfondie. L’agent Chercheur planifie ses recherches, lit ce qu’il trouve sur le web ouvert, et rend un rapport avec ses sources nommées. La règle de l’ancrage que tu viens d’apprendre — elle s’étend jusqu’à Internet.',
      },
    },
    {
      id: 'recap',
      narration: {
        en: 'Chat, used well: ground your questions in your documents, pick models on evidence, let big answers land in the canvas. Next episode: Knowledge — the library your grounded answers come from.',
        de: 'Chat, gut genutzt: Fragen in deinen Dokumenten verankern, Modelle nach Belegen wählen, große Ergebnisse ins Canvas. Nächste Episode: Wissen — die Bibliothek, aus der verankerte Antworten kommen.',
        fr: 'Le chat, bien utilisé : ancrer tes questions dans tes documents, choisir les modèles sur preuves, laisser les grands livrables atterrir dans le canevas. Prochain épisode : Connaissances — la bibliothèque d’où viennent les réponses ancrées.',
      },
    },
    {
      id: 'outro',
      // Same post-narration room as Episode 1: card holds, fade completes inside it.
      tailMs: 3600,
      narration: {
        en: 'The chat guide in the documentation covers everything you saw here, keyboard shortcuts included. See you in episode three.',
        de: 'Der Chat-Leitfaden in der Dokumentation vertieft alles, was du gesehen hast — Tastaturkürzel inklusive. Bis zur dritten Episode.',
        fr: 'Le guide du chat dans la documentation détaille tout ce que tu viens de voir, raccourcis clavier compris. À bientôt pour l’épisode trois.',
      },
    },
  ],
} as const;
