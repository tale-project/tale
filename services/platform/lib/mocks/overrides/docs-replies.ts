/**
 * Prompt-keyed scripts for the docs screenshot pipeline
 * (`tests/docs-screenshots/`). The e2e `MOCK_TRIGGERS` produce correct but
 * visibly synthetic streams (and the trigger keyword shows in the user
 * bubble); docs captures need a workspace that reads like a real customer's.
 * Two kinds of script live here:
 *
 *  - `DOCS_REPLIES` — chat answers. A user message containing a `match`
 *    substring (case-insensitive) streams the scripted markdown `reply`, with
 *    `reasoning` first when present, so "Thinking" captures need no
 *    `e2e:reasoning` marker in the visible message. An entry may carry
 *    per-model variants (`byModel`) — Arena Mode streams ONE prompt into two
 *    model columns, and identical text in both reads as staged.
 *  - `DOCS_TRIAGE_SCORES` — the structured output of the task-triage
 *    workflow's `score` step, per seeded task (see below).
 *
 * Match phrases are distinctive full clauses that no e2e spec message
 * contains, so the default-path specs keep getting `CANNED_REPLY` verbatim
 * (pinned by `contract/openai-compat.test.ts`).
 */

/** The scripted payload a matched prompt streams — default, or per model. */
interface DocsReplyContent {
  /** Markdown streamed as `delta.content`. */
  readonly reply: string;
  /** Optional reasoning streamed first as `delta.reasoning_content`. */
  readonly reasoning?: string;
}

interface DocsReplyModelVariant extends DocsReplyContent {
  /**
   * Lowercase substring matched against the REQUESTED model id — the catalog
   * id on the wire (`anthropic/claude-haiku-4.5`), so a family fragment
   * (`claude-haiku`) matches every point release and the vendor-native id
   * alike.
   */
  readonly model: string;
}

/**
 * A scripted tool call a docs entry emits on its FIRST turn (the resume turn
 * streams the entry's `reply` as the plain-text acknowledgement, exactly like
 * the e2e `MOCK_TRIGGERS` tool scenarios — but from a clean, on-camera prompt
 * with no visible trigger keyword). Args must satisfy the real tool's zod
 * schema; both shapes below mirror the proven `canned.ts` payloads.
 *
 *  - `file_write` executes server-side (no sandbox), so the files land in the
 *    thread workspace and the Canvas pane auto-opens on agent-produced content.
 *  - `request_human_input` creates a real pending approval card in the chat.
 */
export type DocsReplyTool =
  | {
      readonly name: 'file_write';
      readonly files: readonly { path: string; content: string }[];
    }
  | {
      readonly name: 'request_human_input';
      readonly question: string;
      readonly fields: readonly {
        type: 'text';
        label: string;
        required: boolean;
      }[];
    };

interface DocsReply extends DocsReplyContent {
  /** Lowercase substring matched against the LAST user message. */
  readonly match: string;
  /**
   * Per-model overrides of the scripted content; the first whose `model` is a
   * substring of the requested model id wins, otherwise the entry's own
   * `reply`/`reasoning` stand. Arena Mode pins one model per column, so this
   * is what makes the two columns answer differently; every other surface
   * (a seeded chat thread, an auto-routed model) keeps the default.
   */
  readonly byModel?: readonly DocsReplyModelVariant[];
  /**
   * Optional tool call for the entry's first turn. With it, the entry becomes
   * a two-turn script: `reasoning` streams before the tool call, the tool
   * runs, and the follow-up turn (tool result in the conversation) streams
   * `reply` as the acknowledgement — no reasoning the second time. Non-stream
   * calls (thread-title generation) always get the plain `reply`, never tool
   * markup.
   */
  readonly tool?: DocsReplyTool;
  /**
   * Optional short content sentence streamed BEFORE the tool call on the
   * tool turn — the natural model shape (text, then the call). Without any
   * content, a PAUSING tool turn (request_human_input) is judged an empty
   * generation by the fallback layer and a model-switch banner lands in the
   * chat.
   */
  readonly toolIntro?: string;
}

/**
 * The launch-checklist answer's opening line — shared by its default reply AND
 * every model variant, by construction.
 *
 * The docs seeder verifies a seeded chat thread by the first line of the
 * DEFAULT reply (`tests/docs-screenshots/seed-demo-org.ts` → `expectedReply`)
 * and deletes any thread that does not show it. That same prompt is seeded as a
 * normal chat, whose model is picked by auto-routing — so a model variant may
 * well be what renders there. A variant with its own opener would make the
 * seeder read the thread as stale and re-create it on every run.
 */
const LAUNCH_CHECKLIST_OPENER =
  'Here is a launch checklist based on the Website Relaunch project tasks:';

export const DOCS_REPLIES: readonly DocsReply[] = [
  // ——— Video pipeline (tests/docs-videos/) wow-scene replies ———
  // One entry per docs locale: Episode 1 types its hero prompt live on
  // camera and this is the grounded answer that streams back. The prompts
  // live in `tests/docs-videos/episodes/ep1-welcome/episode.ts`
  // (`heroPromptByLocale`) and MUST contain these match clauses verbatim.
  // No `[N]` citation markers — cite chips need real RAG metadata; the reply
  // names its source documents in prose instead.
  {
    match: 'onboarding last quarter',
    reasoning:
      'Searching the workspace knowledge for onboarding feedback from the past quarter. The Q2 support review and the onboarding checklist both cover it — grouping what customers said into themes.',
    reply: [
      'Customers brought up onboarding more than any other topic last quarter. Three themes stand out:',
      '',
      '| Theme | Signal | What customers said |',
      '| --- | --- | --- |',
      '| Setup takes too long | every onboarding call | "Two days from invite to first useful answer." |',
      '| Webhook setup is unclear | questions doubled after the April release | "The setup guide needs a worked example." |',
      '| Shared projects drive adoption | praised twice | "The team space made adoption easy." |',
      '',
      'This reading is based on the **Q2 support review** and the **onboarding checklist** in your workspace knowledge. The support review flags webhook configuration as the fastest-growing driver, and the checklist has no webhook step yet — adding a worked example there would address both of the top complaints.',
    ].join('\n'),
  },
  {
    match: 'zum onboarding gesagt',
    reasoning:
      'Suche im Wissensbestand des Arbeitsbereichs nach Onboarding-Feedback aus dem letzten Quartal. Der Q2-Support-Bericht und die Onboarding-Checkliste sind die relevanten Quellen — die Rückmeldungen werden nach Themen gruppiert.',
    reply: [
      'Onboarding war im letzten Quartal das meistgenannte Thema. Drei Muster stechen heraus:',
      '',
      '| Thema | Signal | Kundenstimme |',
      '| --- | --- | --- |',
      '| Einrichtung dauert zu lange | in jedem Onboarding-Gespräch | „Zwei Tage von der Einladung bis zur ersten brauchbaren Antwort." |',
      '| Webhook-Einrichtung unklar | Fragen nach dem April-Release verdoppelt | „Die Anleitung braucht ein durchgerechnetes Beispiel." |',
      '| Gemeinsame Projekte überzeugen | zweimal ausdrücklich gelobt | „Der Team-Bereich hat die Einführung leicht gemacht." |',
      '',
      'Grundlage sind der **Q2-Support-Bericht** und die **Onboarding-Checkliste** im Wissensbestand. Der Support-Bericht weist Webhook-Fragen als am schnellsten wachsenden Treiber aus, und in der Checkliste fehlt bislang ein Webhook-Schritt — ein durchgerechnetes Beispiel dort würde beide Hauptprobleme zugleich angehen.',
    ].join('\n'),
  },
  {
    match: 'l’onboarding au dernier trimestre',
    reasoning:
      'Recherche dans la base de connaissances de l’espace de travail des retours sur l’onboarding du dernier trimestre. La revue support du T2 et la check-list d’onboarding couvrent le sujet — regroupement des retours par thème.',
    reply: [
      'L’onboarding est le sujet le plus mentionné par les clients au dernier trimestre. Trois thèmes ressortent :',
      '',
      '| Thème | Signal | Verbatim client |',
      '| --- | --- | --- |',
      '| La mise en place prend trop de temps | à chaque appel d’onboarding | « Deux jours entre l’invitation et la première réponse utile. » |',
      '| La configuration des webhooks est floue | questions doublées depuis la version d’avril | « Le guide mérite un exemple complet. » |',
      '| Les projets partagés convainquent | salués à deux reprises | « L’espace d’équipe a facilité l’adoption. » |',
      '',
      'Cette lecture s’appuie sur la **revue support du T2** et la **check-list d’onboarding** de votre base de connaissances. La revue support identifie les webhooks comme la question qui progresse le plus vite, et la check-list n’a pas encore d’étape webhook — y ajouter un exemple complet répondrait aux deux principales frictions.',
    ].join('\n'),
  },
  // ——— Video pipeline: Episode 2 grounding contrast (two triplets) ———
  // The same topic asked twice on camera. UNGROUNDED (no attachment): a
  // confident, fluent, deliberately GENERIC answer with zero workspace facts
  // and no reasoning — the "smooth talker" half of the AI-literacy beat.
  // GROUNDED (Q2 review attached): reasoning first, specific numbers, named
  // sources. Prompts live in `tests/docs-videos/episodes/ep2-chat/`.
  {
    match: 'how do customers feel about our onboarding',
    reply:
      'Customer sentiment around onboarding usually hinges on three things: time to first value, clarity of setup steps, and how quickly early questions get answered. Most teams see the strongest reactions in the first two weeks. Tightening the setup guide and setting expectations early tends to move satisfaction more than any single feature.',
  },
  {
    match: 'zufrieden sind unsere kunden mit dem onboarding',
    reply:
      'Die Zufriedenheit mit dem Onboarding hängt meist an drei Dingen: Zeit bis zum ersten Nutzen, klare Einrichtungsschritte und schnelle Antworten auf frühe Fragen. Die stärksten Reaktionen zeigen sich in den ersten zwei Wochen. Eine gestraffte Anleitung und früh gesetzte Erwartungen bewegen die Zufriedenheit in der Regel mehr als jedes einzelne Feature.',
  },
  {
    match: 'que pensent nos clients de notre onboarding',
    reply:
      'La satisfaction sur l’onboarding tient généralement à trois choses : le délai avant la première valeur, la clarté des étapes d’installation et la rapidité des premières réponses. Les réactions les plus fortes arrivent dans les deux premières semaines. Resserrer le guide et cadrer les attentes tôt fait plus bouger la satisfaction que n’importe quelle fonctionnalité isolée.',
  },
  {
    match: 'fix first in onboarding',
    reasoning:
      'Reading the attached Q2 support review and cross-checking the onboarding checklist. Ranking the fixes by how often customers hit them and how cheap they are to ship.',
    reply: [
      'Based on the **Q2 support review**, fix the webhook setup first.',
      '',
      '- Webhook questions **doubled** after the April release — the fastest-growing driver in the review.',
      '- The setup guide has no worked example, and the **onboarding checklist** has no webhook step at all.',
      '- Password resets and CSV limits drive more tickets in total, but both are stable quarter over quarter.',
      '',
      'One change — a worked webhook example inside the onboarding checklist — addresses the growth driver and closes the checklist gap at once.',
    ].join('\n'),
  },
  {
    match: 'im onboarding zuerst beheben',
    reasoning:
      'Der angehängte Q2-Support-Bericht wird gelesen und mit der Onboarding-Checkliste abgeglichen. Sortiert wird nach Häufigkeit und Umsetzungsaufwand.',
    reply: [
      'Laut dem **Q2-Support-Bericht** zuerst: die Webhook-Einrichtung.',
      '',
      '- Webhook-Fragen haben sich nach dem April-Release **verdoppelt** — der am schnellsten wachsende Treiber im Bericht.',
      '- In der Anleitung fehlt ein durchgerechnetes Beispiel, in der **Onboarding-Checkliste** fehlt der Webhook-Schritt ganz.',
      '- Passwort-Resets und CSV-Limits erzeugen insgesamt mehr Tickets, sind aber im Quartalsvergleich stabil.',
      '',
      'Eine Änderung — ein durchgerechnetes Webhook-Beispiel in der Checkliste — trifft den Wachstumstreiber und schließt die Lücke zugleich.',
    ].join('\n'),
  },
  {
    match: 'corriger en priorité dans l’onboarding',
    reasoning:
      'Lecture de la revue support du T2 jointe, croisée avec la check-list d’onboarding. Classement des corrections par fréquence et coût de mise en œuvre.',
    reply: [
      'D’après la **revue support du T2**, corrige d’abord la configuration des webhooks.',
      '',
      '- Les questions webhooks ont **doublé** depuis la version d’avril — le motif qui progresse le plus vite dans la revue.',
      '- Le guide n’a pas d’exemple complet, et la **check-list d’onboarding** n’a aucune étape webhook.',
      '- Les réinitialisations de mot de passe et les limites CSV génèrent plus de tickets au total, mais restent stables d’un trimestre à l’autre.',
      '',
      'Une seule modification — un exemple complet de webhook dans la check-list — traite le moteur de croissance et comble la lacune d’un coup.',
    ].join('\n'),
  },
  // ——— Video pipeline: Episode 2 source check (one entry per locale) ———
  // The follow-up turn on the GROUNDED thread: the viewer asks which document
  // backs the previous answer, and the reply names the exact seeded files
  // (docs-screenshots demo-content / docs-videos locale-content). Prompts live
  // in `tests/docs-videos/episodes/ep2-chat/episode.ts` (FOLLOWUP_PROMPT) and
  // MUST contain these match clauses verbatim.
  {
    match: 'which document says that',
    reasoning:
      'The webhook claim traces to the attached Q2 support review; the checklist gap to the onboarding checklist. Naming both files.',
    reply:
      'The webhook numbers come from **q2-support-review.txt** — the Q2 support review attached above. It reports webhook questions doubling after the April release and calls out the missing worked example. The checklist gap comes from **onboarding-checklist.txt**. Open either file to check the wording yourself.',
  },
  {
    match: 'welches dokument sagt das',
    reasoning:
      'Die Webhook-Aussage stammt aus dem angehängten Q2-Support-Bericht, die Checklisten-Lücke aus der Onboarding-Checkliste. Beide Dateien werden benannt.',
    reply:
      'Die Webhook-Zahlen stehen in **q2-support-bericht.txt** — dem oben angehängten Q2-Support-Bericht. Er weist die Verdopplung der Webhook-Fragen nach dem April-Release aus und nennt das fehlende durchgerechnete Beispiel. Die Checklisten-Lücke stammt aus **onboarding-checkliste.txt**. Öffne beide Dateien und prüfe den Wortlaut selbst.',
  },
  {
    match: 'quel document le dit',
    reasoning:
      'L’affirmation sur les webhooks vient de la revue support du T2 jointe ; la lacune de la check-list, du document d’onboarding. Les deux fichiers sont nommés.',
    reply:
      'Les chiffres webhooks viennent de **revue-support-t2.txt** — la revue support du T2 jointe plus haut. Elle rapporte le doublement des questions webhooks depuis la version d’avril et pointe l’exemple complet manquant. La lacune de la check-list vient de **check-list-onboarding.txt**. Ouvre les deux fichiers pour vérifier la formulation.',
  },
  // ——— Video pipeline: Episode 3 wow (one entry per locale) ———
  // The take ADDS a knowledge entry on camera (the returns pilot,
  // tests/docs-videos/episodes/ep3-knowledge — deleted off camera after the
  // take), then asks about it; the reply answers from that entry and names
  // it as the source.
  {
    match: 'returns window for annual plans',
    reasoning:
      'Checking the workspace knowledge for a returns policy. The "Returns policy pilot" entry covers annual plans directly.',
    reply:
      'For annual plans, the returns window is **60 days**, effective August — a pilot running until Q4. Monthly plans keep the standard 30 days. Source: the **Returns policy pilot** entry in your workspace knowledge.',
  },
  {
    match: 'rückgabefenster für jahrestarife',
    reasoning:
      'Suche im Wissensbestand nach einer Rückgaberegel. Der Eintrag „Rückgabe-Pilot" deckt Jahrestarife direkt ab.',
    reply:
      'Für Jahrestarife gilt ein Rückgabefenster von **60 Tagen**, wirksam ab August — ein Pilot bis Q4. Monatstarife behalten die üblichen 30 Tage. Quelle: der Eintrag **Rückgabe-Pilot** im Wissensbestand deines Arbeitsbereichs.',
  },
  {
    match: 'fenêtre de retour pour les forfaits annuels',
    reasoning:
      'Recherche d’une règle de retour dans la base de connaissances. L’entrée « Pilote politique de retour » couvre directement les forfaits annuels.',
    reply:
      'Pour les forfaits annuels, la fenêtre de retour est de **60 jours**, effective en août — un pilote jusqu’au T4. Les forfaits mensuels gardent les 30 jours habituels. Source : l’entrée **Pilote politique de retour** dans les connaissances de ton espace de travail.',
  },
  // ——— Video pipeline: Episode 3 stale-knowledge pitfall (one per locale) ———
  // The take asks about last year's retired teal accent; the reply answers
  // from the seeded brand-guidelines document and names it as the ONE bold
  // source (the scene hovers the reply's first <strong>). Prompts live in
  // tests/docs-videos/episodes/ep3-knowledge/episode.ts (PITFALL_PROMPT)
  // and MUST contain these match clauses verbatim.
  {
    match: 'teal accent from last year',
    reasoning:
      'Checking the workspace knowledge for the current palette. The 2026 brand guidelines cover the teal accent directly.',
    reply:
      'No — the teal accent is retired. The 2026 guidelines keep one primary, deep blue #1B3A6B, and the palette section retires the 2025 accent teal outright. New material ships without it. Source: **2026-brand-guidelines.txt** in your workspace documents.',
  },
  {
    match: 'akzent-türkis vom letzten jahr',
    reasoning:
      'Abgleich mit der aktuellen Palette im Wissensbestand. Die Markenrichtlinien 2026 behandeln das Akzent-Türkis direkt.',
    reply:
      'Nein — das Akzent-Türkis ist ausgemustert. Die Richtlinien 2026 führen eine Primärfarbe, Tiefblau #1B3A6B, und der Farbabschnitt erklärt das Türkis von 2025 für Geschichte. Neues Material kommt ohne es aus. Quelle: **markenrichtlinien-2026.txt** in deinen Dokumenten.',
  },
  {
    match: 'turquoise d’accent de l’année dernière',
    reasoning:
      'Vérification de la palette en vigueur dans les connaissances de l’espace de travail. La charte graphique 2026 traite directement du turquoise d’accent.',
    reply:
      'Non — le turquoise d’accent est retiré. La charte 2026 garde une seule primaire, le bleu profond #1B3A6B, et la section couleurs retire le turquoise de 2025. Tout nouveau support s’en passe. Source : **charte-graphique-2026.txt** dans tes documents.',
  },
  // ——— Video pipeline: Episode 5 approval card (one entry per locale) ———
  // The gated outbound reply: reasoning streams, then a `request_human_input`
  // tool call pauses the turn as a REAL pending approval card carrying the
  // draft. The resume turn (after the on-camera decision) streams the ack.
  {
    match: 'annual discount question and send it',
    toolIntro:
      'The draft is ready — sending mail leaves the workspace, so I need your sign-off first.',
    reasoning:
      'Drafting the reply from the pricing thread and the plan terms. Sending mail leaves the workspace — pausing for a human decision before anything goes out.',
    reply:
      'Sent to Bergmann Logistics with your adjustment noted. The approval — who decided, and when — is recorded in the audit log.',
    tool: {
      name: 'request_human_input',
      question:
        'Draft ready for Bergmann Logistics: “Hello Ms. Bergmann — thank you for your patience. Yes: on the annual plan you save 12% against monthly billing, and we can apply it from your next cycle. Shall I set that up?” Send this reply?',
      fields: [{ type: 'text', label: 'Final adjustments', required: true }],
    },
  },
  {
    match: 'jahresrabatt und schick sie',
    toolIntro:
      'Der Entwurf steht — Versand verlässt den Arbeitsbereich, also brauche ich zuerst deine Freigabe.',
    reasoning:
      'Der Antwortentwurf entsteht aus dem Preis-Thread und den Tarifbedingungen. E-Mail-Versand verlässt den Arbeitsbereich — vor dem Senden wird eine menschliche Entscheidung eingeholt.',
    reply:
      'An Bergmann Logistics gesendet, deine Anpassung ist vermerkt. Die Freigabe — wer entschieden hat, und wann — steht im Audit-Protokoll.',
    tool: {
      name: 'request_human_input',
      question:
        'Entwurf für Bergmann Logistics: „Guten Tag Frau Bergmann — danke für Ihre Geduld. Ja: Im Jahrestarif sparen Sie 12 % gegenüber monatlicher Abrechnung, anwendbar ab Ihrem nächsten Zyklus. Soll ich das einrichten?" Diese Antwort senden?',
      fields: [{ type: 'text', label: 'Letzte Anpassungen', required: true }],
    },
  },
  {
    match: 'remise annuelle et envoie',
    toolIntro:
      'Le brouillon est prêt — un envoi sort de l’espace de travail, il me faut d’abord ta validation.',
    reasoning:
      'Le brouillon se construit à partir du fil tarifaire et des conditions du forfait. Envoyer un e-mail sort de l’espace de travail — pause pour une décision humaine avant tout envoi.',
    reply:
      'Envoyé à Bergmann Logistics, ton ajustement noté. La validation — qui a décidé, et quand — est inscrite au journal d’audit.',
    tool: {
      name: 'request_human_input',
      question:
        'Brouillon prêt pour Bergmann Logistics : « Bonjour Madame Bergmann — merci pour votre patience. Oui : le forfait annuel vous fait économiser 12 % par rapport au mensuel, applicable dès votre prochain cycle. Je le mets en place ? » Envoyer cette réponse ?',
      fields: [{ type: 'text', label: 'Derniers ajustements', required: true }],
    },
  },
  // ——— Video pipeline: Episode 4 test-run (one entry per locale) ———
  // The freshly created Support Coach answers its first ask. The reply
  // visibly obeys the instructions typed on camera (friendly, concrete,
  // billing disputes go to a human) — instructions shaping behaviour.
  {
    match: 'asking for an invoice copy',
    reply:
      'Keep it short and warm: confirm which invoice they need, attach the copy from Billing → Invoices, and close with an offer to help further. If the request is actually a billing dispute, stop and hand the thread to a human — that one is outside my mandate.',
  },
  {
    match: 'der eine rechnungskopie möchte',
    reply:
      'Halte es kurz und freundlich: kläre, welche Rechnung gemeint ist, häng die Kopie aus Abrechnung → Rechnungen an und schließe mit einem Angebot für weitere Hilfe. Steckt dahinter ein Rechnungsstreit, stopp — der geht an einen Menschen, so steht es in meinem Auftrag.',
  },
  {
    match: 'demande une copie de facture',
    reply:
      'Reste bref et chaleureux : confirme la facture concernée, joins la copie depuis Facturation → Factures, et termine en proposant ton aide. Si c’est en réalité un litige de facturation, stop — il part chez un humain, c’est dans mon mandat.',
  },
  // ——— Video pipeline: Episode 4 boundary test (one entry per locale) ———
  // The second turn of the test thread: a real billing DISPUTE (invoice
  // 4817 is the distinctive match clause). The decline visibly obeys the
  // hand-off clause typed on camera ("hand any billing dispute to a human")
  // and keeps the mandate's own rules: friendly, concrete, under six
  // sentences. Prompts live in `tests/docs-videos/episodes/ep4-agent/
  // episode.ts` (BOUNDARY_PROMPT) and MUST contain these match clauses
  // verbatim — non-hero prompts are NOT gate-checked by `--stage check`.
  {
    match: 'invoice 4817',
    reasoning:
      'The customer disputes the invoice and refuses to pay — a billing dispute. The typed instructions hand billing disputes to a human: declining the draft and pointing to the hand-off.',
    reply:
      'This one I have to hand over. A disputed invoice is a billing dispute, and my instructions are clear: billing disputes go to a human, not to me. Pass the thread and invoice 4817 to your billing lead — I’ll stay out of the wording. Once the dispute is settled, I’m glad to help draft the follow-up.',
  },
  {
    match: 'rechnung 4817',
    reasoning:
      'Der Kunde bestreitet die Rechnung und verweigert die Zahlung — ein Rechnungsstreit. Die Anweisungen übergeben Rechnungsstreitigkeiten an einen Menschen: Der Entwurf wird abgelehnt und der Vorgang weitergereicht.',
    reply:
      'Das gebe ich ab. Eine bestrittene Rechnung ist ein Rechnungsstreit, und meine Anweisungen sind eindeutig: Der geht an einen Menschen, nicht an mich. Gib den Verlauf samt Rechnung 4817 an die Abrechnung weiter — beim Wortlaut halte ich mich raus. Sobald der Streit geklärt ist, helfe ich gern wieder beim Formulieren.',
  },
  {
    match: 'facture 4817',
    reasoning:
      'Le client conteste la facture et refuse de payer — un litige de facturation. Les instructions confient les litiges de facturation à un humain : le brouillon est refusé, le fil passe à la facturation.',
    reply:
      'Celle-ci, je la transmets. Une facture contestée, c’est un litige de facturation, et mes instructions sont nettes : un litige de facturation part chez un humain, pas chez moi. Passe le fil et la facture 4817 au responsable facturation — je ne touche pas à la formulation. Une fois le litige réglé, je reprends volontiers la rédaction.',
  },
  // ——— Video pipeline: Episode 2 canvas scene (one entry per locale) ———
  // The on-camera prompt asks for a shareable one-pager; the scripted
  // `file_write` lands it in the thread workspace, the Canvas pane auto-opens
  // on the agent-produced file, and the resume turn speaks the ack. Prompts
  // live in `tests/docs-videos/episodes/ep2-chat/` and MUST contain these
  // match clauses verbatim. The brief's content is data — native per locale,
  // grounded in the same Q2 themes as the Episode 1 wow answer.
  {
    match: 'one-page brief for the leadership team',
    reasoning:
      'Pulling the three onboarding themes from the Q2 support review and shaping them into a one-page brief for leadership. Writing it to the canvas as a shareable document.',
    reply:
      'The brief is on the canvas — one page: the three themes, the evidence behind each, and one recommended next step. Edit it there directly, or ask me for a tighter cut.',
    tool: {
      name: 'file_write',
      files: [
        {
          path: '/agent/output/onboarding-brief.md',
          content: [
            '# Onboarding — what customers told us in Q2',
            '',
            '**For the leadership team — one page, three themes.**',
            '',
            '## 1. Setup takes too long',
            '',
            'Raised in every onboarding call. "Two days from invite to first useful answer."',
            'The slow step is workspace configuration, not the product itself.',
            '',
            '## 2. Webhook setup is unclear',
            '',
            'Questions doubled after the April release. The setup guide still has no worked',
            'example, and the onboarding checklist has no webhook step at all.',
            '',
            '## 3. Shared projects drive adoption',
            '',
            'Praised in two of three calls: "The team space made adoption easy." Teams that',
            'started inside a shared project reached daily use fastest.',
            '',
            '## Recommended next step',
            '',
            'Add a worked webhook example to the onboarding checklist — it addresses the two',
            'loudest complaints at once. Owner: onboarding squad. Effort: one sprint.',
            '',
          ].join('\n'),
        },
      ],
    },
  },
  {
    match: 'einseitiges briefing für die geschäftsleitung',
    reasoning:
      'Die drei Onboarding-Themen aus dem Q2-Support-Bericht werden zu einem einseitigen Briefing für die Geschäftsleitung verdichtet. Das Dokument entsteht im Canvas.',
    reply:
      'Das Briefing liegt im Canvas — eine Seite: die drei Themen, die Belege dazu und ein empfohlener nächster Schritt. Du kannst dort direkt weiterarbeiten oder eine kürzere Fassung anfordern.',
    tool: {
      name: 'file_write',
      files: [
        {
          path: '/agent/output/onboarding-briefing.md',
          content: [
            '# Onboarding — das Kundenfeedback aus Q2',
            '',
            '**Für die Geschäftsleitung — eine Seite, drei Themen.**',
            '',
            '## 1. Die Einrichtung dauert zu lange',
            '',
            'In jedem Onboarding-Gespräch genannt. „Zwei Tage von der Einladung bis zur',
            'ersten brauchbaren Antwort." Der langsame Schritt ist die Konfiguration, nicht',
            'das Produkt.',
            '',
            '## 2. Die Webhook-Einrichtung ist unklar',
            '',
            'Die Fragen haben sich nach dem April-Release verdoppelt. In der Anleitung fehlt',
            'ein durchgerechnetes Beispiel, in der Checkliste der Webhook-Schritt.',
            '',
            '## 3. Gemeinsame Projekte überzeugen',
            '',
            'In zwei von drei Gesprächen gelobt: „Der Team-Bereich hat die Einführung leicht',
            'gemacht." Teams mit gemeinsamem Projekt erreichten die tägliche Nutzung am',
            'schnellsten.',
            '',
            '## Empfohlener nächster Schritt',
            '',
            'Ein durchgerechnetes Webhook-Beispiel in die Onboarding-Checkliste aufnehmen —',
            'das adressiert die zwei häufigsten Beschwerden zugleich. Aufwand: ein Sprint.',
            '',
          ].join('\n'),
        },
      ],
    },
  },
  {
    match: 'synthèse d’une page pour la direction',
    reasoning:
      'Les trois thèmes d’onboarding de la revue support du T2 sont condensés en une synthèse d’une page pour la direction. Le document s’écrit dans le canevas.',
    reply:
      'La synthèse est dans le canevas — une page : les trois thèmes, les éléments à l’appui et une prochaine étape recommandée. Tu peux la retoucher directement, ou me demander une version plus courte.',
    tool: {
      name: 'file_write',
      files: [
        {
          path: '/agent/output/synthese-onboarding.md',
          content: [
            '# Onboarding — ce que les clients nous ont dit au T2',
            '',
            '**Pour la direction — une page, trois thèmes.**',
            '',
            '## 1. La mise en place prend trop de temps',
            '',
            'Mentionné à chaque appel d’onboarding. « Deux jours entre l’invitation et la',
            'première réponse utile. » L’étape lente est la configuration, pas le produit.',
            '',
            '## 2. La configuration des webhooks est floue',
            '',
            'Les questions ont doublé depuis la version d’avril. Le guide n’a toujours pas',
            'd’exemple complet, et la check-list n’a pas d’étape webhook.',
            '',
            '## 3. Les projets partagés font adopter le produit',
            '',
            'Salués dans deux appels sur trois : « L’espace d’équipe a facilité l’adoption. »',
            'Les équipes parties d’un projet partagé ont atteint l’usage quotidien le plus vite.',
            '',
            '## Prochaine étape recommandée',
            '',
            'Ajouter un exemple complet de webhook à la check-list d’onboarding — cela répond',
            'aux deux frictions principales à la fois. Charge : un sprint.',
            '',
          ].join('\n'),
        },
      ],
    },
  },
  // ——— Video pipeline: Episode 2 canvas refinement (one entry per locale) ———
  // The second turn on the canvas thread: one plain sentence, and the
  // `file_write` overwrites the SAME path the first brief landed on — the
  // pane shows the trimmed version in place. Each locale keeps its brief's H1
  // (the pane anchor) and carries the refined-marker line
  // (`CANVAS_REFINED_MARKER` in tests/docs-videos/episodes/ep2-chat/) that
  // exists ONLY in this version — the take's "rewrite landed" anchor.
  {
    match: 'cut it to three bullets',
    reasoning:
      'Rewriting the brief in place: same file, same heading — the three themes compressed to one bullet each, the recommendation kept.',
    reply:
      'Done — the brief is down to three bullets, in the same file on the canvas. Ask me for the long version any time.',
    tool: {
      name: 'file_write',
      files: [
        {
          path: '/agent/output/onboarding-brief.md',
          content: [
            '# Onboarding — what customers told us in Q2',
            '',
            '**The three-bullet version for leadership.**',
            '',
            '- **Setup takes too long** — raised in every onboarding call; the slow step is configuration, not the product.',
            '- **Webhook setup is unclear** — questions doubled since the April release; still no worked example anywhere.',
            '- **Shared projects drive adoption** — praised in two of three calls; start onboardings inside one.',
            '',
            'Next step: a worked webhook example in the onboarding checklist. Owner: onboarding squad.',
            '',
          ].join('\n'),
        },
      ],
    },
  },
  {
    match: 'kürze es auf drei stichpunkte',
    reasoning:
      'Gleiche Datei, gleiche Überschrift — die drei Themen schrumpfen auf je einen Punkt, die Empfehlung bleibt. Das Briefing entsteht an Ort und Stelle neu.',
    reply:
      'Erledigt — das Briefing steht jetzt in drei Punkten, in derselben Datei im Canvas. Sag Bescheid, wenn du die lange Fassung wieder brauchst.',
    tool: {
      name: 'file_write',
      files: [
        {
          path: '/agent/output/onboarding-briefing.md',
          content: [
            '# Onboarding — das Kundenfeedback aus Q2',
            '',
            '**Die Drei-Punkte-Fassung für die Geschäftsleitung.**',
            '',
            '- **Die Einrichtung dauert zu lange** — in jedem Onboarding-Gespräch genannt; die Konfiguration bremst, nicht das Produkt.',
            '- **Die Webhook-Einrichtung ist unklar** — Fragen nach dem April-Release verdoppelt; ein durchgerechnetes Beispiel fehlt weiterhin.',
            '- **Gemeinsame Projekte überzeugen** — in zwei von drei Gesprächen gelobt; Onboardings am besten direkt im gemeinsamen Projekt starten.',
            '',
            'Nächster Schritt: ein durchgerechnetes Webhook-Beispiel in der Onboarding-Checkliste.',
            '',
          ].join('\n'),
        },
      ],
    },
  },
  {
    match: 'réduis-la à trois puces',
    reasoning:
      'Même fichier, même titre — chaque thème condensé en une puce, la recommandation conservée. La synthèse se réécrit sur place.',
    reply:
      'C’est fait — la synthèse tient en trois puces, dans le même fichier sur le canevas. Demande la version longue quand tu veux.',
    tool: {
      name: 'file_write',
      files: [
        {
          path: '/agent/output/synthese-onboarding.md',
          content: [
            '# Onboarding — ce que les clients nous ont dit au T2',
            '',
            '**La version en trois puces pour la direction.**',
            '',
            '- **La mise en place prend trop de temps** — mentionné à chaque appel ; la configuration ralentit, pas le produit.',
            '- **La configuration des webhooks est floue** — questions doublées depuis avril ; toujours pas d’exemple complet.',
            '- **Les projets partagés font adopter le produit** — salués dans deux appels sur trois ; démarrer chaque onboarding dans un projet partagé.',
            '',
            'Prochaine étape : un exemple complet de webhook dans la check-list d’onboarding.',
            '',
          ].join('\n'),
        },
      ],
    },
  },
  {
    match: 'summarize the onboarding feedback',
    reasoning:
      'Reading the three feedback documents in the knowledge base, grouping the recurring points by theme, and ranking the themes by how often they come up.',
    reply: [
      'Across the three onboarding calls, the feedback clusters into three themes:',
      '',
      '| Theme | Mentions | Representative quote |',
      '| --- | --- | --- |',
      '| Setup took too long | 3 of 3 | "Two days from invite to first useful answer." |',
      '| Docs assume context | 2 of 3 | "The guide names screens I could not find." |',
      '| Loved the shared projects | 2 of 3 | "The team space made adoption easy." |',
      '',
      'The setup friction is the clear priority — every call raised it, and two customers tied it directly to their go-live date. The project workspace praise suggests leading future onboardings with a prepared shared project.',
    ].join('\n'),
  },
  {
    // Also the Arena Mode prompt (`chat-arena-split`), which pins one model per
    // column — so each column gets its own answer below: same task, different
    // shape. Two hard constraints on every variant:
    //   - it OPENS with `LAUNCH_CHECKLIST_OPENER` (by construction below), and
    //   - it carries "launch-blocking ones" exactly once — the docs capture
    //     waits for that phrase to appear in the SECOND column.
    match: 'draft a launch checklist for the website relaunch',
    reply: [
      LAUNCH_CHECKLIST_OPENER,
      '',
      '1. **Content freeze** — final copy signed off by marketing.',
      '2. **Redirect map** — every legacy URL mapped and tested.',
      '3. **Performance pass** — Core Web Vitals green on the staging build.',
      '4. **Accessibility sweep** — keyboard navigation and contrast checked.',
      '5. **Rollback plan** — the previous build deployable in one step.',
      '',
      'Items 2 and 5 are the launch-blocking ones; the rest can land during the release window.',
    ].join('\n'),
    byModel: [
      {
        // Arena column A — the fast model: short, flat, gets to the point.
        model: 'claude-haiku',
        reply: [
          LAUNCH_CHECKLIST_OPENER,
          '',
          '1. **Freeze the content** — marketing signs off the homepage copy.',
          '2. **Ship the redirect map** — all 380 legacy URLs mapped and tested.',
          '3. **Check performance** — Core Web Vitals green on staging.',
          '4. **Sweep accessibility** — keyboard paths and AA contrast.',
          '5. **Rehearse the rollback** — the previous build back in one step.',
          '',
          'Steps 2 and 5 are the launch-blocking ones.',
        ].join('\n'),
      },
      {
        // Arena column B — the deeper model: grouped by phase, names the risks.
        model: 'claude-sonnet',
        reply: [
          LAUNCH_CHECKLIST_OPENER,
          '',
          '**Before the content freeze**',
          '',
          '- Homepage copy final and signed off by marketing.',
          '- Redirect map complete: 340 of the 380 legacy URLs are mapped today.',
          '',
          '**Go-live gates**',
          '',
          '- Core Web Vitals green on the staging build.',
          '- Accessibility sweep clean — keyboard navigation, focus order, AA contrast.',
          '- Rollback rehearsed: the previous build redeploys in one step, no data loss.',
          '',
          '**Risks worth flagging**',
          '',
          '- The 40 unmapped blog URLs are still an open decision — settle redirect-vs-keep before the freeze.',
          '- The accessibility sweep has no agreed severity bar, so "done" is undefined today.',
          '',
          'The redirect map and the rollback rehearsal are the launch-blocking ones; everything else can land inside the release window.',
        ].join('\n'),
      },
    ],
  },
  // ——— Video pipeline: Episode 2 Arena scene, de/fr (native prompts) ———
  // The en Arena take reuses the seeded launch-checklist entry above; the
  // de/fr takes type a NATIVE prompt, so each needs its own entry with
  // per-model variants. Every variant opens with its locale's shared opener
  // (the contract test pins that), and carries its column-wait phrase —
  // "blockieren den Launch" / "bloquantes pour le lancement" — exactly once.
  {
    match: 'launch-checkliste für den website-relaunch',
    reply: [
      'Hier ist eine Launch-Checkliste auf Basis der Website-Relaunch-Aufgaben:',
      '',
      '1. **Content-Freeze** — die finalen Texte sind vom Marketing freigegeben.',
      '2. **Redirect-Map** — jede alte URL ist gemappt und getestet.',
      '3. **Performance-Check** — Core Web Vitals auf Staging im grünen Bereich.',
      '4. **Accessibility-Durchgang** — Tastaturwege und Kontraste geprüft.',
      '5. **Rollback-Plan** — der vorherige Build ist in einem Schritt zurückholbar.',
      '',
      'Die Punkte 2 und 5 blockieren den Launch; der Rest kann im Release-Fenster landen.',
    ].join('\n'),
    byModel: [
      {
        model: 'claude-haiku',
        reply: [
          'Hier ist eine Launch-Checkliste auf Basis der Website-Relaunch-Aufgaben:',
          '',
          '1. **Texte einfrieren** — Marketing gibt die Startseite frei.',
          '2. **Redirect-Map liefern** — alle 380 alten URLs gemappt und getestet.',
          '3. **Performance prüfen** — Core Web Vitals auf Staging grün.',
          '4. **Accessibility fegen** — Tastaturpfade und AA-Kontraste.',
          '5. **Rollback proben** — der vorherige Build in einem Schritt zurück.',
          '',
          'Die Schritte 2 und 5 blockieren den Launch.',
        ].join('\n'),
      },
      {
        model: 'claude-sonnet',
        reply: [
          'Hier ist eine Launch-Checkliste auf Basis der Website-Relaunch-Aufgaben:',
          '',
          '**Vor dem Content-Freeze**',
          '',
          '- Startseiten-Texte final und vom Marketing freigegeben.',
          '- Redirect-Map vollständig: 340 der 380 alten URLs sind heute gemappt.',
          '',
          '**Go-live-Gates**',
          '',
          '- Core Web Vitals auf dem Staging-Build grün.',
          '- Accessibility-Durchgang sauber — Tastaturnavigation, Fokusreihenfolge, AA-Kontrast.',
          '- Rollback geprobt: der vorherige Build in einem Schritt, ohne Datenverlust.',
          '',
          '**Erwähnenswerte Risiken**',
          '',
          '- Für 40 alte Blog-URLs steht die Entscheidung Redirect-oder-behalten noch aus.',
          '- Für den Accessibility-Durchgang fehlt eine vereinbarte Schweregrenze.',
          '',
          'Redirect-Map und Rollback-Probe blockieren den Launch; alles andere kann im Release-Fenster landen.',
        ].join('\n'),
      },
    ],
  },
  {
    match: 'check-list de lancement pour la refonte du site',
    reply: [
      'Voici une check-list de lancement fondée sur les tâches de la refonte du site :',
      '',
      '1. **Gel du contenu** — les textes finaux sont validés par le marketing.',
      '2. **Plan de redirections** — chaque ancienne URL est mappée et testée.',
      '3. **Passe performance** — Core Web Vitals au vert sur le staging.',
      '4. **Passe accessibilité** — navigation clavier et contrastes vérifiés.',
      '5. **Plan de rollback** — le build précédent se redéploie en une étape.',
      '',
      'Les étapes 2 et 5 sont bloquantes pour le lancement ; le reste peut arriver dans la fenêtre de release.',
    ].join('\n'),
    byModel: [
      {
        model: 'claude-haiku',
        reply: [
          'Voici une check-list de lancement fondée sur les tâches de la refonte du site :',
          '',
          '1. **Geler le contenu** — le marketing valide la page d’accueil.',
          '2. **Livrer le plan de redirections** — les 380 anciennes URL mappées et testées.',
          '3. **Vérifier la performance** — Core Web Vitals au vert sur le staging.',
          '4. **Passer l’accessibilité** — parcours clavier et contrastes AA.',
          '5. **Répéter le rollback** — le build précédent revient en une étape.',
          '',
          'Les étapes 2 et 5 sont bloquantes pour le lancement.',
        ].join('\n'),
      },
      {
        model: 'claude-sonnet',
        reply: [
          'Voici une check-list de lancement fondée sur les tâches de la refonte du site :',
          '',
          '**Avant le gel du contenu**',
          '',
          '- Textes d’accueil finaux, validés par le marketing.',
          '- Plan de redirections complet : 340 des 380 anciennes URL sont mappées aujourd’hui.',
          '',
          '**Portes de mise en ligne**',
          '',
          '- Core Web Vitals au vert sur le build de staging.',
          '- Passe accessibilité propre — navigation clavier, ordre de focus, contraste AA.',
          '- Rollback répété : le build précédent se redéploie en une étape, sans perte de données.',
          '',
          '**Risques à signaler**',
          '',
          '- Les 40 anciennes URL du blog attendent une décision : rediriger ou conserver.',
          '- La passe accessibilité n’a pas de seuil de gravité convenu.',
          '',
          'Le plan de redirections et la répétition du rollback sont les étapes bloquantes pour le lancement ; tout le reste peut arriver dans la fenêtre de release.',
        ].join('\n'),
      },
    ],
  },
  {
    match: 'what changed in the brand guidelines',
    reply: [
      'Comparing the 2026 brand guidelines with the previous version, three things changed:',
      '',
      '- **Primary palette** — the blue deepened one step; the old accent teal is retired.',
      '- **Logo clearspace** — minimum clearspace grew from 0.5× to 1× the mark height.',
      '- **Tone of voice** — the "playful" register is gone; all copy now uses the direct register.',
      '',
      'Everything else — typography, iconography, photography rules — carried over unchanged.',
    ].join('\n'),
  },
  {
    match: 'plan the quarterly business review agenda',
    reasoning:
      'The QBR needs the numbers first, then the narrative: revenue and usage, then wins and risks, then next quarter. Keeping it to five items so it fits a 60-minute slot.',
    reply: [
      'A 60-minute QBR agenda that keeps the numbers up front:',
      '',
      '1. **Usage & revenue snapshot** (10 min) — quarter over quarter, one slide.',
      '2. **Wins** (10 min) — the two launches that moved adoption.',
      '3. **Risks** (15 min) — churn signals and the support backlog.',
      '4. **Roadmap next quarter** (15 min) — three committed items only.',
      '5. **Asks & decisions** (10 min) — what needs sign-off today.',
      '',
      'Send the snapshot deck a day ahead so the meeting starts at item 2.',
    ].join('\n'),
  },
  {
    match: 'python script to deduplicate',
    reasoning:
      'The export is a CSV keyed by email; normalizing case and whitespace before comparing catches most duplicates. Keeping the most recently updated row when two collide.',
    reply: [
      'This script keeps the most recently updated row per email address:',
      '',
      '```python',
      'import csv',
      'from datetime import datetime',
      '',
      'def parse(row):',
      '    return datetime.fromisoformat(row["updated_at"])',
      '',
      'rows = {}',
      'with open("crm-export.csv", newline="") as f:',
      '    for row in csv.DictReader(f):',
      '        key = row["email"].strip().lower()',
      '        if key not in rows or parse(row) > parse(rows[key]):',
      '            rows[key] = row',
      '',
      'with open("crm-deduped.csv", "w", newline="") as f:',
      '    writer = csv.DictWriter(f, fieldnames=next(iter(rows.values())).keys())',
      '    writer.writeheader()',
      '    writer.writerows(rows.values())',
      '```',
      '',
      'Point it at the export in the current directory; it writes `crm-deduped.csv` next to it and never mutates the original.',
    ].join('\n'),
  },
  {
    match: 'which customers mentioned pricing concerns',
    reply: [
      'Two customers raised pricing in the indexed conversations:',
      '',
      '- **Northwind Manufacturing** — asked whether seat pricing applies to read-only members (conversation from June 12).',
      '- **Bergmann Logistics** — compared the team plan with a competitor quote and asked about annual discounts (June 24).',
      '',
      'Both conversations are open in the inbox; neither has a follow-up scheduled yet.',
    ].join('\n'),
  },
] as const;

/** What a matched prompt scripts: content (default or per-model) + any tool. */
interface MatchedDocsReply extends DocsReplyContent {
  readonly tool?: DocsReplyTool;
  readonly toolIntro?: string;
}

/**
 * The scripted content for a chat body's last user message, or null when no
 * docs phrase matches (the caller falls through to the e2e scenarios). When
 * the matched entry scripts the requested `model`, that variant wins over its
 * default `reply`/`reasoning`; the entry's `tool` (if any) always rides along.
 */
export function matchDocsReply(
  lastUserText: string,
  model?: string,
): MatchedDocsReply | null {
  const text = lastUserText.toLowerCase();
  const entry = DOCS_REPLIES.find((reply) => text.includes(reply.match));
  if (!entry) return null;
  const modelId = (model ?? '').toLowerCase();
  const content =
    entry.byModel?.find((v) => modelId.includes(v.model)) ?? entry;
  if (!entry.tool) return content;
  return {
    reply: content.reply,
    reasoning: content.reasoning,
    tool: entry.tool,
    ...(entry.toolIntro !== undefined ? { toolIntro: entry.toolIntro } : {}),
  };
}

/**
 * The marker every `score`-step prompt of the auto-installed
 * `projects__tasks__triage-unassigned` automation carries (its
 * `score.config.userPrompt` renders the candidate list under this exact
 * heading), alongside `Task title: <title>`.
 */
const TRIAGE_PROMPT_MARKER =
  'Candidates (slug, description, isManager, preferred):'.toLowerCase();

/** A scripted `score` result for one seeded task. */
interface DocsTriageScore {
  /** Lowercase substring matched against the triage prompt — the task title. */
  readonly task: string;
  /**
   * The object the step's `generateObject` call must parse. Its schema requires
   * ALL THREE fields; `confidence` is optional HERE only so the one deliberate
   * failure below can omit it (see `DOCS_TRIAGE_SCORES`).
   */
  readonly score: {
    readonly slug: string;
    readonly confidence?: number;
    readonly reason: string;
  };
}

/**
 * The `score` step of the task-triage automation is a structured-output call
 * (`generateObject`, schema `{slug, confidence, reason}`) — and the mock's
 * blanket `{}` for every `json*` request fails its validation, so every scored
 * task ended in a FAILED run and the docs Executions capture was a wall of red.
 *
 * One entry per task the docs seeder creates (`tests/docs-screenshots/
 * demo-content.ts` → `DEMO_PROJECTS[].tasks`), so the runs complete and the log
 * reads like a real one:
 *
 *  - `slug` is `assistant` — the auto-installed agent, so the downstream
 *    `assign` action resolves a live candidate and the run reaches `done`.
 *  - `confidence` >= 0.7 clears the automation's auto-assign bar, so the run
 *    assigns the agent; below it the run leaves a suggestion comment instead.
 *    Both COMPLETE. Assignment is not free of side effects — it acks the task
 *    into `in_progress` (`agents/run_agent_on_task.ts`), moving its board card
 *    — so tasks on the captured board score below the bar and the assign path
 *    is exercised on the project no board shot captures.
 *  - "Prepare the rollback plan" deliberately omits `confidence`, so
 *    `generateObject` genuinely rejects it and that ONE run fails with a real
 *    schema-validation error — the red badge the execution-logs docs page
 *    teaches debugging from. Delete the field and every run turns green.
 *
 * Only the seeder's `todo` tasks reach the scoring step (the automation's guard
 * is `!assigneeId && status == 'todo'`; the rest short-circuit to its output
 * node and still complete). Every seeded task is scripted anyway, so flipping a
 * seeded status cannot turn a run red — the contract test pins that pairing.
 *
 * An unlisted task (any task an e2e spec creates) matches nothing and keeps the
 * `{}` fallback — its triage run fails exactly as it does today, so this script
 * cannot start assigning agents inside the e2e suite.
 */
const DOCS_TRIAGE_SCORES: readonly DocsTriageScore[] = [
  // ——— Video pipeline: Episode 5 on-camera task (one per locale) ———
  // Created live on the relaunch board to fire the task.created trigger the
  // viewer just read; scores above the auto-assign bar so the assignment
  // lands on camera. Archived off camera after the take.
  {
    task: 'prepare the launch-day social posts',
    score: {
      slug: 'assistant',
      confidence: 0.81,
      reason:
        'Social copy is drafting work, and the brand guidelines and content inventory are indexed.',
    },
  },
  {
    task: 'social-posts für den launch-tag vorbereiten',
    score: {
      slug: 'assistant',
      confidence: 0.81,
      reason:
        'Social-Texte sind Schreibarbeit; Markenrichtlinien und Content-Inventar sind indexiert.',
    },
  },
  {
    task: 'préparer les posts sociaux du jour j',
    score: {
      slug: 'assistant',
      confidence: 0.81,
      reason:
        'Les posts sont un travail de rédaction ; la charte et l’inventaire de contenu sont indexés.',
    },
  },
  // ——— Video pipeline: Episode 6 on-camera task (one per locale) ———
  // Created live on the relaunch board; scores above the auto-assign bar so
  // the agent visibly takes the card. Archived off camera after the take.
  {
    task: 'draft the launch announcement post',
    score: {
      slug: 'assistant',
      confidence: 0.82,
      reason:
        'Announcement copy is drafting work, and the brand guidelines plus content inventory are indexed.',
    },
  },
  {
    task: 'launch-ankündigung entwerfen',
    score: {
      slug: 'assistant',
      confidence: 0.82,
      reason:
        'Ankündigungstexte sind Schreibarbeit; Markenrichtlinien und Content-Inventar sind indexiert.',
    },
  },
  {
    task: 'rédiger l’annonce de lancement',
    score: {
      slug: 'assistant',
      confidence: 0.82,
      reason:
        'Le texte d’annonce est un travail de rédaction ; la charte et l’inventaire de contenu sont indexés.',
    },
  },
  // Project: Website relaunch.
  {
    task: 'finalize homepage copy with marketing',
    score: {
      slug: 'assistant',
      confidence: 0.84,
      reason:
        'Homepage copy is a drafting job, and the 2026 brand guidelines are already indexed.',
    },
  },
  {
    task: 'map legacy urls to the new structure',
    score: {
      slug: 'assistant',
      confidence: 0.78,
      reason:
        'The content inventory lists all 380 legacy URLs, so building the redirect map is mechanical.',
    },
  },
  {
    task: 'run the accessibility sweep on staging',
    score: {
      slug: 'assistant',
      confidence: 0.72,
      reason:
        'The assistant can walk the WCAG checklist over staging and report what it finds.',
    },
  },
  // ——— Video pipeline locale orgs (tests/docs-videos) ———
  // The de/fr demo orgs stage one green and one red triage run each
  // (lib/locale-content.ts `stagedTasks`); same contract as the English
  // titles above — the red ones omit `confidence` on purpose.
  {
    task: 'launch-checkliste freigeben',
    score: {
      slug: 'assistant',
      confidence: 0.84,
      reason:
        'Die Checkliste liegt im Projektwissen; der Assistent kann den Freigabeentwurf vorbereiten.',
    },
  },
  {
    task: 'valider la check-list de lancement',
    score: {
      slug: 'assistant',
      confidence: 0.84,
      reason:
        'La check-list est dans la base du projet ; l’assistant peut préparer la validation.',
    },
  },
  // Deliberately BELOW the auto-assign bar (same contract as the EN
  // 'sign off the launch checklist' entry): the run COMPLETES via the
  // suggestion branch, leaving the comment Episode 6's pitfall beat reads.
  {
    task: 'go-live-freigabe erteilen',
    score: {
      slug: 'assistant',
      confidence: 0.55,
      reason:
        'Der Assistent kann die Nachweise zusammenstellen; die Freigabe selbst liegt beim Release-Verantwortlichen.',
    },
  },
  {
    task: 'donner le feu vert à la mise en ligne',
    score: {
      slug: 'assistant',
      confidence: 0.55,
      reason:
        'L’assistant peut rassembler les preuves, mais le feu vert revient au responsable du lancement.',
    },
  },
  {
    task: 'rollback-plan vorbereiten',
    score: {
      slug: 'assistant',
      reason:
        'Ein Rollback-Plan braucht Deployment-Kontext, den nur das Team hat.',
    },
  },
  {
    task: 'préparer le plan de rollback',
    score: {
      slug: 'assistant',
      reason:
        'Un plan de rollback demande un contexte de déploiement que seule l’équipe possède.',
    },
  },
  {
    // The ONE deliberate failure: no `confidence`, so the step's schema
    // validation rejects it and this run ends `failed`. Keep exactly one.
    task: 'prepare the rollback plan',
    score: {
      slug: 'assistant',
      reason:
        'The launch-day runbook already sketches the rollback, so this is mostly a write-up.',
    },
  },
  {
    // Deliberately BELOW the auto-assign bar — twice right. The step's own
    // system prompt asks for a low score when a task "likely needs a human",
    // and a launch sign-off does; and this task sits on the ONE board the docs
    // capture (`projects-task-board` shoots DEMO_PROJECTS[0]), where an
    // assignment would ack the card into `in_progress` and empty the To do
    // column the seeder tuned. It still COMPLETES — via the suggestion branch.
    task: 'sign off the launch checklist',
    score: {
      slug: 'assistant',
      confidence: 0.55,
      reason:
        'The assistant can assemble the evidence for each item, but the sign-off itself needs the release owner.',
    },
  },
  {
    task: 'rebuild the legacy pricing page',
    score: {
      slug: 'assistant',
      confidence: 0.77,
      reason:
        'A single page rebuild against the new information architecture is well-scoped work.',
    },
  },
  {
    // Seeded in `backlog`, so the automation's guard routes it straight to the
    // output node and this score is never requested. It is scripted anyway: an
    // unscripted title falls back to `{}`, so the day someone moves this card to
    // To do it would fail the step and put a second red row in the docs shot.
    task: 'audit the third-party scripts',
    score: {
      slug: 'assistant',
      confidence: 0.69,
      reason:
        'The assistant can inventory the tags, but dropping one needs a call from marketing.',
    },
  },
  // Project: Customer onboarding portal.
  {
    task: 'draft the welcome email sequence',
    score: {
      slug: 'assistant',
      confidence: 0.88,
      reason:
        'A welcome sequence is writing work, and the onboarding checklist gives the assistant the beats.',
    },
  },
  {
    task: 'design the progress checklist screen',
    score: {
      slug: 'assistant',
      confidence: 0.73,
      reason:
        'The onboarding checklist defines the steps, so a first pass at the screen is well specified.',
    },
  },
  {
    task: 'wire the crm webhook for new sign-ups',
    score: {
      slug: 'assistant',
      confidence: 0.79,
      reason:
        'Webhook setup is documented work, and the Q2 support review flags it as a recurring gap.',
    },
  },
  {
    task: 'review the trial-to-paid handoff flow',
    score: {
      slug: 'assistant',
      confidence: 0.75,
      reason:
        'The handoff spans the onboarding checklist and the support notes, both of which the assistant can read.',
    },
  },
] as const;

/**
 * The scripted structured output for a task-triage `score` call, serialized as
 * the model would return it — or null when the prompt is not a triage call, or
 * names a task with no script (both keep the caller's `{}` fallback).
 */
export function matchDocsTriageScore(promptText: string): string | null {
  const text = promptText.toLowerCase();
  if (!text.includes(TRIAGE_PROMPT_MARKER)) return null;
  const entry = DOCS_TRIAGE_SCORES.find((score) => text.includes(score.task));
  return entry ? JSON.stringify(entry.score) : null;
}
