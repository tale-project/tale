/**
 * Episode 3 — "Knowledge: what your AI knows", rebuilt on the in-depth arc
 * the Episode 5 pilot locked in. The viewer DOES the work on camera: adds a
 * knowledge entry (the returns pilot — cleaned up after the take), reads
 * what Indexed means on the documents table, looks a price up in the
 * products records by real search, walks the website crawler's add dialog
 * (closed without saving, and the voice says so), opens the control that
 * narrows a document to one team, hits the stale-knowledge pitfall in chat
 * (the retired teal accent, answered from the current brand guidelines) —
 * and verifies the promise: a fresh chat cites the entry created minutes
 * earlier.
 *
 * Register (produce-video STORYBOARD.md): tutorial grammar — announce every
 * move before it happens (signpost → action → observation → meaning), and
 * silence does the pacing: chapter lead-ins 2.2–2.6 s, tail beats after
 * landed points, generous minMs floors (real fr audio runs shorter than the
 * estimates, so typing/creation scenes carry the floor, not the narration).
 *
 * Prompt pairing (lib/mocks/overrides/docs-replies.ts): the hero prompt
 * (returns window) pairs with the existing Episode 3 triplet and is
 * gate-checked. PITFALL_PROMPT needs a NEW triplet (delivered with this
 * rewrite's report) — `--stage check` does NOT validate non-hero prompts,
 * so until that triplet lands, the pitfall turn streams the visibly
 * synthetic e2e canned reply.
 */

import type { EpisodeSpec, Locale } from '../../lib/episode';

/** The knowledge entry typed on camera — topic + content, native per locale.
 * The topic pairs with the bold source name in the existing docs-reply. */
export const ENTRY_TOPIC: Record<Locale, string> = {
  en: 'Returns policy pilot',
  de: 'Rückgabe-Pilot',
  fr: 'Pilote politique de retour',
};

export const ENTRY_CONTENT: Record<Locale, string> = {
  en: 'From August, annual plans get a 60-day returns window (pilot until Q4). Monthly plans keep the standard 30 days.',
  de: 'Ab August gilt für Jahrestarife ein Rückgabefenster von 60 Tagen (Pilot bis Q4). Monatstarife behalten die üblichen 30 Tage.',
  fr: 'À partir d’août, les forfaits annuels passent à une fenêtre de retour de 60 jours (pilote jusqu’au T4). Les forfaits mensuels gardent les 30 jours habituels.',
};

/**
 * The stale-knowledge pitfall ask — typed live in chat. Pairs with the NEW
 * docs-replies triplet (match clauses: 'teal accent from last year' /
 * 'akzent-türkis vom letzten jahr' / 'turquoise d’accent de l’année
 * dernière'); the reply answers from the seeded brand-guidelines document
 * and names it as the bold source. NOT gate-checked (only hero prompts
 * are) — apply the triplet before recording.
 */
export const PITFALL_PROMPT: Record<Locale, string> = {
  en: 'Can we still use the teal accent from last year in new material?',
  de: 'Können wir das Akzent-Türkis vom letzten Jahr noch in neuem Material verwenden?',
  fr: 'Est-ce qu’on peut encore utiliser le turquoise d’accent de l’année dernière ?',
};

export const EP3_KNOWLEDGE: EpisodeSpec = {
  id: 'ep3-knowledge',
  section: 'tutorials',
  titleByLocale: {
    en: 'Knowledge: what your AI knows',
    de: 'Wissen: was deine KI weiß',
    fr: 'Connaissances : ce que ton IA sait',
  },
  episodeLabelByLocale: {
    en: 'Episode 3',
    de: 'Episode 3',
    fr: 'Épisode 3',
  },
  needsKnowledgeDb: true,
  wholeTakeLocales: ['en'],
  voices: {
    en: 'WZlYpi1yf6zJhNWXih74',
    de: 'rKiu7lQ4c5P3az3745s3',
    fr: 'QbsdzCokdlo98elkq4Pc',
  },
  /** The verify ask about the entry added on camera; pairs with the
   * existing docs-replies triplet (gate-checked). */
  heroPromptByLocale: {
    en: 'What is our returns window for annual plans?',
    de: 'Wie lang ist unser Rückgabefenster für Jahrestarife?',
    fr: 'Quelle est notre fenêtre de retour pour les forfaits annuels ?',
  },
  scenes: [
    {
      // Cold open over the knowledge-entries list — where the on-camera
      // fact will land. The card lifts at a cue INSIDE this scene, before
      // the voice names the visible page.
      id: 'title',
      leadInMs: 1600,
      minMs: 27_000,
      narration: {
        en: 'Welcome to episode three. Today we take our time with knowledge: everything your assistant knows about your company, and how it gets there. You’ll add a real fact yourself, and a few minutes later the assistant will hand it back — with the source named. We’ll go step by step. This page — knowledge entries — is where your fact will live. Let’s look around first.',
        de: 'Willkommen zu Episode drei. Heute nehmen wir uns Zeit für Wissen: alles, was dein Assistent über deine Firma weiß — und wie es dorthin kommt. Du legst selbst einen echten Fakt an, und ein paar Minuten später bekommst du ihn zitiert zurück, mit benannter Quelle. Wir gehen Schritt für Schritt vor. Diese Seite — die Wissenseinträge — hier wird dein Fakt landen. Aber sehen wir uns erst um.',
        fr: 'Bienvenue dans l’épisode trois. Aujourd’hui, on prend le temps avec les connaissances : tout ce que ton assistant sait de ton entreprise, et comment ça y entre. Tu vas ajouter un vrai fait toi-même, et quelques minutes plus tard, l’assistant te le rendra — source nommée. On avance étape par étape. Cette page — les entrées de connaissances — c’est là que ton fait va atterrir. Mais d’abord, un tour des lieux.',
      },
    },
    {
      // A real tab click to Documents — the knowledge area's geography.
      id: 'context',
      chapterByLocale: { en: 'Knowledge', de: 'Wissen', fr: 'Connaissances' },
      leadInMs: 2400,
      tailMs: 1600,
      minMs: 22_000,
      narration: {
        en: 'Let’s start next door, in Documents — one tab over. Three files live here already: the 2026 brand guidelines, a support review, an onboarding checklist. And see the tab row at the top? Documents, knowledge entries, websites, products — that row is the whole area for today. Everything an agent answers from sits behind one of these tabs.',
        de: 'Wir starten nebenan, in den Dokumenten — einen Tab weiter. Drei Dateien liegen schon hier: die Markenrichtlinien 2026, ein Support-Bericht, eine Onboarding-Checkliste. Und sieh dir die Tab-Leiste oben an: Dokumente, Wissenseinträge, Websites, Produkte — diese Leiste ist unser ganzes Gebiet für heute. Alles, woraus ein Agent antwortet, liegt hinter einem dieser Tabs.',
        fr: 'Commençons à côté, dans les Documents — un onglet plus loin. Trois fichiers sont déjà là : la charte graphique 2026, une revue support, une check-list d’onboarding. Et regarde la rangée d’onglets en haut : Documents, Entrées de connaissances, Sites web, Produits — c’est tout notre terrain du jour. Tout ce qu’un agent répond s’appuie sur l’un de ces onglets.',
      },
    },
    {
      // Task 1 opens: the decision (entry vs document vs record), then the
      // list. The Add click itself belongs to the next scene's words.
      id: 'entry-why',
      chapterByLocale: {
        en: 'Add a fact',
        de: 'Fakt anlegen',
        fr: 'Ajouter un fait',
      },
      leadInMs: 2400,
      tailMs: 1500,
      minMs: 24_000,
      narration: {
        en: 'Now let’s add a fact of our own — we switch back to Knowledge entries. Say the team just piloted a new returns window: sixty days on annual plans. It’s in nobody’s document yet. For one sentence of truth, an entry is the right shape — a document would bury it, and a record is for typed values, like prices.',
        de: 'Jetzt legen wir einen eigenen Fakt an — wir wechseln zurück zu den Wissenseinträgen. Sagen wir, das Team hat gerade ein neues Rückgabefenster pilotiert: sechzig Tage für Jahrestarife. Das steht noch in keinem Dokument. Für einen Satz Wahrheit ist ein Eintrag die richtige Form — ein Dokument würde ihn begraben, und Datensätze sind für typisierte Werte wie Preise.',
        fr: 'Maintenant, ajoutons un fait à nous — on repasse sur Entrées de connaissances. Disons que l’équipe vient de piloter une nouvelle fenêtre de retour : soixante jours sur les forfaits annuels. Aucun document ne le dit encore. Pour une phrase de vérité, l’entrée est la bonne forme — un document la noierait, et les fiches servent aux valeurs typées, comme les prix.',
      },
    },
    {
      // The real creation: dialog, topic, content, save — row in the list.
      id: 'entry-create',
      tailMs: 1800,
      minMs: 26_000,
      narration: {
        en: 'So we click Add entry. Topic first: the returns policy pilot. Then the content — one clear sentence that stands on its own. And… save. There it is, in the list. No deploy, no retraining: indexing runs on its own, and we’ll come back to test this at the end.',
        de: 'Also: Eintrag hinzufügen. Zuerst das Thema: der Rückgabe-Pilot. Dann der Inhalt — ein klarer Satz, der für sich allein verständlich ist. Und … speichern. Da ist er, in der Liste. Kein Deployment, kein Training: Die Indexierung läuft von selbst, und am Ende stellen wir sie auf die Probe.',
        fr: 'Donc : Ajouter une entrée. D’abord le sujet : le pilote de retour. Puis le contenu — une phrase claire, qui se comprend toute seule. Et… enregistrer. La voilà, dans la liste. Aucun déploiement, aucun entraînement : l’indexation tourne toute seule, et on viendra la tester à la fin.',
      },
    },
    {
      // Task 2: what Indexed means — and the not-training boundary.
      id: 'indexed',
      chapterByLocale: {
        en: 'Documents & records',
        de: 'Dokumente & Datensätze',
        fr: 'Documents & fiches',
      },
      leadInMs: 2400,
      tailMs: 1600,
      minMs: 23_000,
      narration: {
        en: 'Back to Documents, and this time watch the badges. Indexed means: the text was pulled out, split into passages, and every passage made findable. Nothing was trained. Your files change no model and never leave this workspace — at answer time, the assistant fetches the passages it needs, source attached. That’s what fed the citations you checked in episode two.',
        de: 'Zurück zu den Dokumenten — und diesmal achte auf die Abzeichen. Indexiert heißt: Text extrahiert, in Passagen zerlegt, jede Passage auffindbar gemacht. Trainiert wurde nichts. Deine Dateien ändern kein Modell und verlassen den Arbeitsbereich nie — beim Antworten holt sich der Assistent genau die Passagen, die er braucht, mit Quelle daran. Daraus kamen die Zitate, die du in Episode zwei geprüft hast.',
        fr: 'Retour aux Documents — et cette fois, regarde les badges. Indexé veut dire : texte extrait, découpé en passages, chaque passage retrouvable. Rien n’a été entraîné. Tes fichiers ne changent aucun modèle et ne quittent jamais l’espace de travail — au moment de répondre, l’assistant va chercher les passages qu’il lui faut, source attachée. C’est ce qui nourrissait les citations que tu vérifiais dans l’épisode deux.',
      },
    },
    {
      // Still task 2, announced on-camera tab click: a real lookup in the
      // typed records — search narrows the table to one row.
      id: 'records',
      leadInMs: 1400,
      tailMs: 1600,
      minMs: 25_000,
      narration: {
        en: 'One tab over: Products. Documents hold prose; records hold values — an agent reads the price from a field instead of guessing it from a paragraph. Let’s look one up for real. We type ‘workshop’ into the search… the table narrows to one row… and there’s the price: 950. An agent doing a quote reads exactly this row.',
        de: 'Einen Tab weiter: Produkte. Dokumente tragen Prosa; Datensätze tragen Werte — ein Agent liest den Preis aus einem Feld, statt ihn aus einem Absatz zu raten. Schlagen wir einen echt nach. Wir tippen „Workshop" in die Suche … die Tabelle schrumpft auf eine Zeile … und da steht der Preis: 950. Genau diese Zeile liest auch ein Agent für ein Angebot.',
        fr: 'Un onglet plus loin : Produits. Les documents portent la prose ; les fiches portent les valeurs — un agent lit le prix dans un champ au lieu de le deviner dans un paragraphe. Cherchons-en un pour de vrai. On tape « Atelier » dans la recherche… le tableau se resserre sur une ligne… et voilà le prix : 950. C’est exactement la ligne qu’un agent lit pour un devis.',
      },
    },
    {
      // Task 3: the crawler's add dialog — domain, scan interval, and an
      // honest close without saving.
      id: 'websites',
      chapterByLocale: { en: 'Websites', de: 'Websites', fr: 'Sites web' },
      leadInMs: 2400,
      tailMs: 1600,
      minMs: 30_000,
      narration: {
        en: 'Next tab: Websites. Public sites can join your knowledge too — let’s walk the dialog without saving. Add website… a domain… and here’s the setting that matters: the scan interval. The crawler re-visits on that rhythm — hourly at the fastest, every thirty days at the slowest. It sees only what an anonymous visitor sees; anything behind a login belongs in Documents. We’re not really adding this one — Escape.',
        de: 'Nächster Tab: Websites. Auch öffentliche Seiten können ins Wissen einfließen — gehen wir den Dialog durch, ohne zu speichern. Website hinzufügen … eine Domain … und hier die Einstellung, die zählt: das Scan-Intervall. In diesem Rhythmus liest der Crawler die Seite neu — stündlich am schnellsten, alle dreißig Tage am langsamsten. Er sieht nur, was ein anonymer Besucher sieht; was hinter einem Login liegt, gehört in die Dokumente. Wir fügen die Seite nicht wirklich hinzu — Escape.',
        fr: 'Onglet suivant : Sites web. Les sites publics peuvent aussi alimenter les connaissances — parcourons le dialogue, sans enregistrer. Ajouter un site web… un domaine… et voici le réglage qui compte : l’intervalle d’analyse. Le crawler relit le site à ce rythme — toutes les heures au plus vite, tous les trente jours au plus lent. Il ne voit que ce qu’un visiteur anonyme voit ; ce qui est derrière un login relève des Documents. On n’ajoute pas vraiment ce site — Échap.',
      },
    },
    {
      // Task 4: who sees what — the document's team control, left unsaved.
      // Knowledge entries carry no such switch (org-scoped by design), and
      // the narration says so.
      id: 'scopes',
      chapterByLocale: {
        en: 'Who sees what',
        de: 'Wer sieht was',
        fr: 'Qui voit quoi',
      },
      leadInMs: 2400,
      tailMs: 1600,
      minMs: 30_000,
      narration: {
        en: 'One question left before the test: who gets to read all this? Back in Documents, we open the row menu on the brand guidelines… and pick Assign team. Right now the file is organization-wide — every member’s agents may use it. Pick a team instead, and it stays inside that team. We leave the guidelines open to everyone — Cancel. One note: knowledge entries don’t have this switch; they always serve the whole workspace.',
        de: 'Eine Frage noch vor der Probe: Wer darf das alles lesen? Zurück in den Dokumenten öffnen wir das Zeilenmenü der Markenrichtlinien … und wählen Team zuweisen. Im Moment ist die Datei organisationsweit — die Agenten jedes Mitglieds dürfen sie nutzen. Wähl stattdessen ein Team, und sie bleibt in diesem Team. Wir lassen die Richtlinien für alle offen — Abbrechen. Ein Hinweis noch: Wissenseinträge haben diesen Schalter nicht; sie gelten immer im ganzen Arbeitsbereich.',
        fr: 'Une question avant le test : qui peut lire tout ça ? De retour dans les Documents, on ouvre le menu de la ligne charte graphique… et on choisit Assigner une équipe. Pour l’instant, le fichier est ouvert à toute l’organisation — les agents de chaque membre peuvent s’en servir. Choisis une équipe à la place, et il reste dans cette équipe. On laisse la charte ouverte à tous — Annuler. Une précision : les entrées de connaissances n’ont pas ce réglage ; elles servent toujours tout l’espace de travail.',
      },
    },
    {
      // The pitfall, asked live: stale knowledge, the retired teal accent.
      id: 'pitfall-ask',
      chapterByLocale: {
        en: 'When it goes stale',
        de: 'Wenn Wissen veraltet',
        fr: 'Quand ça date',
      },
      leadInMs: 2400,
      tailMs: 1500,
      minMs: 28_000,
      narration: {
        en: 'On to the chat, for the failure you’ll actually meet: not a missing fact — an outdated one. Last year our accent color was teal; the 2026 guidelines retired it. Would the assistant know? We ask, exactly like a teammate would… and watch what comes back.',
        de: 'Weiter in den Chat, zum Fehler, der dir wirklich begegnet: kein fehlender Fakt — ein veralteter. Letztes Jahr war unsere Akzentfarbe Türkis; die Richtlinien 2026 haben sie ausgemustert. Weiß der Assistent das? Wir fragen, genau wie es ein Kollege täte … und schauen, was zurückkommt.',
        fr: 'Direction le chat, pour l’échec que tu croiseras vraiment : pas un fait manquant — un fait périmé. L’an dernier, notre couleur d’accent était le turquoise ; la charte 2026 l’a retiré. L’assistant le sait-il ? On pose la question, comme un collègue le ferait… et on regarde ce qui revient.',
      },
    },
    {
      // The answer read together, then the counterfactual — diagnosed,
      // never moralized.
      id: 'pitfall-read',
      leadInMs: 1000,
      tailMs: 1800,
      minMs: 22_000,
      narration: {
        en: 'Read it with me: the teal is retired, the primary is deep blue — and the source is named, the brand guidelines file. The assistant caught this because someone kept that file current. If last year’s palette still sat in Documents, you’d get the opposite answer, delivered just as confidently. So when facts change: stale file out, one current truth per topic.',
        de: 'Lies mit: Das Türkis ist ausgemustert, die Primärfarbe ist Tiefblau — und die Quelle steht dabei, die Markenrichtlinien-Datei. Der Assistent hat das erkannt, weil jemand diese Datei aktuell hält. Läge die alte Palette noch in den Dokumenten, bekämst du die gegenteilige Antwort — genauso überzeugt vorgetragen. Wenn sich Fakten ändern, gilt also: alte Datei raus, eine aktuelle Wahrheit pro Thema.',
        fr: 'Lis avec moi : le turquoise est retiré, la primaire est le bleu profond — et la source est nommée, le fichier de la charte. L’assistant l’a su parce que quelqu’un garde ce fichier à jour. Si l’ancienne palette traînait encore dans les Documents, tu aurais la réponse inverse — assénée avec le même aplomb. Donc quand un fait change : vieux fichier dehors, une seule vérité à jour par sujet.',
      },
    },
    {
      // Verify, part 1: a fresh chat asks for the fact added minutes ago.
      id: 'verify-ask',
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 25_000,
      narration: {
        en: 'And now, the promise from the start. We open a fresh chat… and ask about the returns window — the fact we added, four minutes ago. No agent was configured, nothing was deployed in between.',
        de: 'Und jetzt das Versprechen vom Anfang. Wir öffnen einen frischen Chat … und fragen nach dem Rückgabefenster — dem Fakt von vor vier Minuten. Kein Agent wurde konfiguriert, nichts wurde ausgerollt.',
        fr: 'Et voici la promesse du début. On ouvre un chat tout neuf… et on pose la question sur la fenêtre de retour — le fait ajouté il y a quatre minutes. Aucun agent configuré, rien déployé entre-temps.',
      },
    },
    {
      // Verify, part 2: the cited answer names the on-camera entry.
      id: 'verify-read',
      leadInMs: 1000,
      tailMs: 1800,
      minMs: 19_000,
      narration: {
        en: 'Sixty days on annual plans, thirty on monthly — and look at the source: the returns policy pilot, the exact entry you watched me create. Fact in, cited answer out. And every teammate’s chat gets this same answer now.',
        de: 'Sechzig Tage für Jahrestarife, dreißig für Monatstarife — und sieh auf die Quelle: der Rückgabe-Pilot, genau der Eintrag von eben. Fakt rein, zitierte Antwort raus. Und jeder Chat im Team bekommt ab jetzt dieselbe Antwort.',
        fr: 'Soixante jours sur les forfaits annuels, trente sur les mensuels — et regarde la source : le pilote de retour, l’entrée exacte créée il y a quelques minutes. Un fait qui entre, une réponse citée qui sort. Et chaque chat de l’équipe donne désormais la même réponse.',
      },
    },
    {
      id: 'recap',
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 18_000,
      narration: {
        en: 'That’s the episode. You added a fact and heard it cited back, read what Indexed means, pulled a price from a record, met the crawler’s scan interval, and opened the control that limits a document to one team. The knowledge section of the docs goes deeper on every tab you saw.',
        de: 'Das war die Episode. Du hast einen Fakt angelegt und zitiert zurückbekommen, gelesen, was Indexiert bedeutet, einen Preis aus einem Datensatz geholt, das Scan-Intervall des Crawlers gesehen und den Schalter geöffnet, der ein Dokument auf ein Team begrenzt. Der Wissens-Bereich der Doku vertieft jeden Tab, den du gesehen hast.',
        fr: 'Voilà l’épisode. Tu as ajouté un fait et tu l’as entendu cité en retour, lu ce que veut dire Indexé, tiré un prix d’une fiche, vu l’intervalle d’analyse du crawler, et ouvert le réglage qui limite un document à une équipe. La section Connaissances de la doc approfondit chaque onglet.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'Next time: agents — you’ll build one of your own, instructions and all. See you in episode four.',
        de: 'Nächstes Mal: Agenten — du baust deinen eigenen, mit Anweisungen und allem. Bis zur vierten Episode.',
        fr: 'La prochaine fois : les agents — tu construiras le tien, instructions comprises. À bientôt pour l’épisode quatre.',
      },
    },
  ],
} as const;
