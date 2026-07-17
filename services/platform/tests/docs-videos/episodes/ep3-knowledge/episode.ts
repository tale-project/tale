/**
 * Episode 3 — "Knowledge: what your AI knows". The library behind every
 * grounded answer: documents and the indexing pipeline, curated knowledge
 * entries (one added ON CAMERA and cited in chat two minutes later), typed
 * records, the website crawler and its honest anonymous-visitor boundary,
 * retrieval scopes as least privilege, and the curation habit.
 *
 * Three AI-literacy beats: indexing is NOT training; visibility is a
 * decision (scopes); garbage in, confident garbage out (curation).
 *
 * The on-camera entry (`ENTRY_*`) is deleted off camera after the take
 * (recorder cleanup via the `cleanupEntryTopics` note). The wow prompt pairs
 * with its docs-reply; the reply names the entry as its source.
 */

import type { EpisodeSpec, Locale } from '../../lib/episode';

/** The knowledge entry typed on camera — topic + content, native per locale. */
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
  /** The wow ask about the entry added on camera; pairs with docs-replies. */
  heroPromptByLocale: {
    en: 'What is our returns window for annual plans?',
    de: 'Wie lang ist unser Rückgabefenster für Jahrestarife?',
    fr: 'Quelle est notre fenêtre de retour pour les forfaits annuels ?',
  },
  scenes: [
    {
      id: 'title',
      leadInMs: 1200,
      narration: {
        en: 'Every grounded answer in this series comes from one place. This episode: the knowledge library — what goes in, how it becomes searchable, and who gets to see what.',
        de: 'Jede verankerte Antwort in dieser Serie kommt aus einem Ort. In dieser Episode: die Wissensbibliothek — was hineinkommt, wie es durchsuchbar wird und wer was sehen darf.',
        fr: 'Chaque réponse ancrée de cette série vient d’un seul endroit. Dans cet épisode : la bibliothèque de connaissances — ce qui y entre, comment cela devient consultable, et qui voit quoi.',
      },
    },
    {
      id: 'documents',
      chapterByLocale: { en: 'Documents', de: 'Dokumente', fr: 'Documents' },
      leadInMs: 900,
      narration: {
        en: 'Documents live here. Reports, guidelines, meeting notes — drop them in, and the indexing pipeline takes over: extract the text, split it into passages, make every passage findable. The Indexed badge means: ready to be cited.',
        de: 'Dokumente wohnen hier. Berichte, Richtlinien, Notizen — ablegen, und die Indexierung übernimmt: Text extrahieren, in Passagen teilen, jede Passage auffindbar machen. Das Abzeichen „Indexiert" heißt: bereit, zitiert zu werden.',
        fr: 'Les documents vivent ici. Rapports, chartes, notes de réunion — dépose-les, et l’indexation prend le relais : extraire le texte, le découper en passages, rendre chaque passage trouvable. Le badge « Indexé » veut dire : prêt à être cité.',
      },
    },
    {
      id: 'indexing',
      narration: {
        en: 'One thing worth being precise about: indexing is not training. Your documents change no model. They stay in your workspace, and at answer time the agent retrieves exactly the passages it needs — with the source attached. That is why you could check every claim in episode two.',
        de: 'Ein Punkt verdient Präzision: Indexieren ist kein Training. Deine Dokumente verändern kein Modell. Sie bleiben in deinem Arbeitsbereich, und beim Antworten holt sich der Agent genau die Passagen, die er braucht — mit Quelle daran. Genau deshalb konntest du in Episode zwei jede Aussage prüfen.',
        fr: 'Un point mérite d’être précis : indexer n’est pas entraîner. Tes documents ne modifient aucun modèle. Ils restent dans ton espace de travail, et au moment de répondre, l’agent récupère exactement les passages nécessaires — la source attachée. Voilà pourquoi tu pouvais vérifier chaque affirmation de l’épisode deux.',
      },
    },
    {
      id: 'entries',
      chapterByLocale: {
        en: 'Entries',
        de: 'Einträge',
        fr: 'Entrées',
      },
      // Knowledge sub-pages are deep links (the icon rail has no visible
      // sub-nav to click) — jump under the veil.
      chapterTransition: 'cut',
      // Navigation + dialog + typing topic and content + save.
      minMs: 18_000,
      narration: {
        en: 'For facts that live in nobody’s document, there are knowledge entries — short, curated truths. We add one now: the returns pilot for annual plans. Topic, content, save… and it is already part of what every agent here knows.',
        de: 'Für Fakten, die in keinem Dokument stehen, gibt es Wissenseinträge — kurze, gepflegte Wahrheiten. Wir legen jetzt einen an: den Rückgabe-Pilot für Jahrestarife. Thema, Inhalt, speichern … und schon gehört er zu dem, was jeder Agent hier weiß.',
        fr: 'Pour les faits qui ne vivent dans aucun document, il y a les entrées de connaissances — des vérités courtes et entretenues. On en ajoute une : le pilote de retour des forfaits annuels. Sujet, contenu, enregistrer… et elle fait déjà partie de ce que chaque agent sait ici.',
      },
    },
    {
      id: 'structured',
      chapterByLocale: {
        en: 'Records',
        de: 'Datensätze',
        fr: 'Fiches',
      },
      chapterTransition: 'cut',
      minMs: 11_000,
      narration: {
        en: 'Some knowledge is not prose at all. Products, customers, vendors — typed records with real fields. An agent reads the price from the row instead of guessing it from a paragraph. Documents for text, records for values.',
        de: 'Manches Wissen ist gar keine Prosa. Produkte, Kunden, Lieferanten — typisierte Datensätze mit echten Feldern. Ein Agent liest den Preis aus der Zeile, statt ihn aus einem Absatz zu raten. Dokumente für Text, Datensätze für Werte.',
        fr: 'Une partie du savoir n’est pas de la prose. Produits, clients, fournisseurs — des fiches typées avec de vrais champs. Un agent lit le prix dans la ligne au lieu de le deviner dans un paragraphe. Les documents pour le texte, les fiches pour les valeurs.',
      },
    },
    {
      id: 'websites',
      chapterByLocale: { en: 'Websites', de: 'Websites', fr: 'Sites web' },
      chapterTransition: 'cut',
      // Navigation + opening the add dialog + typing a domain + closing.
      minMs: 14_000,
      narration: {
        en: 'Public websites join through the crawler. Hand it a domain and a rhythm, and it keeps the index in step with the site. One honest boundary: it sees what an anonymous visitor sees. Anything behind a login belongs in documents instead.',
        de: 'Öffentliche Websites kommen über den Crawler dazu. Gib ihm eine Domain und einen Rhythmus, und er hält den Index im Takt der Seite. Eine ehrliche Grenze: Er sieht, was ein anonymer Besucher sieht. Was hinter einem Login liegt, gehört stattdessen in die Dokumente.',
        fr: 'Les sites publics arrivent par le crawler. Donne-lui un domaine et un rythme, et il garde l’index au pas du site. Une limite honnête : il voit ce qu’un visiteur anonyme voit. Ce qui vit derrière un login relève des documents.',
      },
    },
    {
      id: 'scopes',
      chapterByLocale: { en: 'Access', de: 'Zugriff', fr: 'Accès' },
      // Rail to agents, open the Assistant, its knowledge scope on screen.
      minMs: 14_000,
      narration: {
        en: 'And who sees what is a decision, not an accident. An agent’s knowledge scope names exactly what it may read — team documents stay in the team, workspace documents serve everyone, uploads stay with their chat. Give each agent the smallest library that does the job.',
        de: 'Und wer was sieht, ist eine Entscheidung, kein Zufall. Der Wissensbereich eines Agenten benennt genau, was er lesen darf — Team-Dokumente bleiben im Team, Arbeitsbereich-Dokumente dienen allen, Uploads bleiben bei ihrem Chat. Gib jedem Agenten die kleinste Bibliothek, die den Job erledigt.',
        fr: 'Et qui voit quoi est une décision, pas un accident. Le périmètre de connaissances d’un agent nomme exactement ce qu’il peut lire — les documents d’équipe restent dans l’équipe, ceux de l’espace de travail servent tout le monde, les uploads restent dans leur chat. Donne à chaque agent la plus petite bibliothèque qui fait le travail.',
      },
    },
    {
      id: 'curation',
      narration: {
        en: 'One habit keeps all of this trustworthy: curate. The model believes what you give it — a stale price list or a duplicate draft becomes a confident wrong answer. Treat the library like a wiki the whole company quotes. Because from now on, it is.',
        de: 'Eine Gewohnheit hält das alles vertrauenswürdig: pflegen. Das Modell glaubt, was du ihm gibst — eine veraltete Preisliste oder ein doppelter Entwurf wird zur selbstbewussten falschen Antwort. Behandle die Bibliothek wie ein Wiki, aus dem die ganze Firma zitiert. Denn genau das ist sie ab jetzt.',
        fr: 'Une habitude garde tout cela digne de confiance : entretenir. Le modèle croit ce que tu lui donnes — une grille tarifaire périmée ou un brouillon en double devient une réponse fausse et sûre d’elle. Traite la bibliothèque comme un wiki que toute l’entreprise cite. Parce que désormais, c’en est un.',
      },
    },
    {
      id: 'wow',
      // New chat + typed question + streamed grounded answer.
      minMs: 16_000,
      narration: {
        en: 'The proof. We ask about the returns pilot we added two minutes ago… and there it is — answered from the entry, source named. Knowledge in, grounded answer out.',
        de: 'Die Probe. Wir fragen nach dem Rückgabe-Pilot von vorhin … und da ist er — beantwortet aus dem Eintrag, Quelle benannt. Wissen rein, verankerte Antwort raus.',
        fr: 'La preuve. On pose la question sur le pilote de retour ajouté il y a deux minutes… et la voilà — répondue depuis l’entrée, source nommée. Du savoir qui entre, une réponse ancrée qui sort.',
      },
    },
    {
      id: 'recap',
      narration: {
        en: 'That is the library: documents indexed, facts pinned as entries, records typed, websites crawled — and scopes deciding who reads what. Next episode: building your first agent.',
        de: 'Das ist die Bibliothek: Dokumente indexiert, Fakten als Einträge festgehalten, Datensätze typisiert, Websites gecrawlt — und der Zugriff entscheidet, wer was liest. Nächste Episode: dein erster Agent.',
        fr: 'Voilà la bibliothèque : documents indexés, faits épinglés en entrées, fiches typées, sites explorés — et des périmètres qui décident qui lit quoi. Prochain épisode : construire ton premier agent.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'The knowledge section of the documentation covers every shape you saw here. See you in episode four.',
        de: 'Der Wissens-Bereich der Dokumentation vertieft jede Form, die du hier gesehen hast. Bis zur vierten Episode.',
        fr: 'La section Connaissances de la documentation détaille chaque forme vue ici. À bientôt pour l’épisode quatre.',
      },
    },
  ],
} as const;
