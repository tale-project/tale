/**
 * Per-locale demo CONTENT for the video takes. UI chrome localizes itself,
 * but seeded data (task titles, document names, knowledge entries) is data —
 * a German viewer must see a German workspace, so de/fr record against their
 * own demo orgs seeded from these structures (en records against the shared
 * docs-screenshots org and its English content).
 *
 * Same fiction as `../docs-screenshots/demo-content.ts` — Northlight Labs
 * mid-website-relaunch — written natively per locale (write-translations),
 * never word-for-word. The wow-scene document names pair with the bold
 * source names in `lib/mocks/overrides/docs-replies.ts`, and the two staged
 * trigger tasks pair with `DOCS_TRIAGE_SCORES` (one green, one red).
 */

import type {
  DemoDocument,
  DemoKnowledgeEntry,
  DemoProduct,
  DemoProject,
} from '../../docs-screenshots/demo-content';
import {
  DEMO_DOCUMENTS,
  DEMO_MCP_SERVER,
  DEMO_KNOWLEDGE_ENTRIES,
  DEMO_PRODUCTS,
  DEMO_PROJECT_FILES,
  DEMO_PROJECTS,
  DEMO_TEAMS,
} from '../../docs-screenshots/demo-content';
import type { Locale } from './episode';

interface VideoDemoContent {
  readonly projects: readonly DemoProject[];
  readonly documents: readonly DemoDocument[];
  readonly knowledgeEntries: readonly DemoKnowledgeEntry[];
  readonly products: readonly DemoProduct[];
  /** Team names are on-camera DATA — native per locale (Episode 8). */
  readonly teams: readonly string[];
  /** The MCP server row (Episode 7) — native display name. */
  readonly mcpServer: {
    name: string;
    displayName: string;
    description: string;
    url: string;
  };
  /** The relaunch project's attached files (Episode 6) — native names. */
  readonly projectFiles: readonly DemoDocument[];
  /** The document the wow scene attaches — first in `documents` by contract. */
  readonly wowSourceDoc: string;
  /** Green-run + red-run + below-the-bar suggestion tasks staged for the
   * executions log and the Episode 6 non-assignment beat. */
  readonly stagedTasks: {
    readonly green: string;
    readonly red: string;
    readonly suggested: string;
  };
  /** Board-scene targets: readiness/first hover, then the second hover. */
  readonly boardReadyTask: string;
  readonly boardHoverTask: string;
}

const DE_PROJECTS: readonly DemoProject[] = [
  {
    name: 'Website-Relaunch',
    tasks: [
      // The two triage-trigger titles ('Launch-Checkliste freigeben',
      // 'Rollback-Plan vorbereiten') are NOT seeded — the staging step
      // creates them so their creation fires the green/red runs.
      { title: 'Third-Party-Skripte prüfen', status: 'backlog' },
      {
        title: 'Startseiten-Texte mit Marketing abstimmen',
        status: 'in_progress',
      },
      { title: 'Accessibility-Durchgang auf Staging', status: 'in_review' },
      { title: 'Alte URLs auf die neue Struktur mappen', status: 'done' },
      { title: 'Alte Preisseite neu bauen', status: 'cancelled' },
    ],
  },
  {
    name: 'Kunden-Onboarding-Portal',
    tasks: [
      { title: 'Fortschritts-Checkliste entwerfen', status: 'todo' },
      {
        title: 'CRM-Webhook für neue Registrierungen anbinden',
        status: 'todo',
      },
      { title: 'Willkommens-E-Mail-Strecke entwerfen', status: 'in_progress' },
      { title: 'Trial-zu-Kauf-Übergabe prüfen', status: 'done' },
    ],
  },
];

const DE_DOCUMENTS: readonly DemoDocument[] = [
  {
    fileName: 'q2-support-bericht.txt',
    mimeType: 'text/plain',
    content: [
      '# Q2-Support-Bericht',
      '',
      'Das Ticketvolumen stieg um 12 % gegenüber dem Vorquartal; die mediane',
      'erste Antwort hielt sich bei 42 Minuten. Die drei größten Treiber:',
      'Passwort-Resets, Webhook-Einrichtung und CSV-Import-Limits. Webhook-',
      'Fragen haben sich nach dem April-Release verdoppelt — die Anleitung',
      'braucht ein durchgerechnetes Beispiel.',
    ].join('\n'),
  },
  {
    fileName: 'onboarding-checkliste.txt',
    mimeType: 'text/plain',
    content: [
      '# Onboarding-Checkliste',
      '',
      '1. Kickoff-Termin innerhalb von 3 Tagen nach Vertragsschluss.',
      '2. Arbeitsbereich vor dem Kickoff angelegt und gebrandet.',
      '3. Erstes gemeinsames Projekt mit Beispielaufgaben vorbereitet.',
      '4. Erfolgskennzahlen vereinbart und im Account-Plan festgehalten.',
    ].join('\n'),
  },
  {
    fileName: 'markenrichtlinien-2026.txt',
    mimeType: 'text/plain',
    content: [
      '# Northlight Labs Markenrichtlinien (2026)',
      '',
      '## Farben',
      'Primärfarbe: Tiefblau #1B3A6B. Das Akzent-Türkis von 2025 ist Geschichte.',
      '',
      '## Logo',
      'Mindestabstand: 1x Markenhöhe auf allen Seiten.',
      '',
      '## Tonalität',
      'Direkte Ansprache, kurze Sätze, keine Ausrufezeichen.',
    ].join('\n'),
  },
];

const DE_KNOWLEDGE: readonly DemoKnowledgeEntry[] = [
  {
    topic: 'Support-Erstantwort-Ziel',
    content:
      'Der Support antwortet werktags (Mo–Fr, 9:00–17:00 MEZ) innerhalb von 45 Minuten. Der Q2-Median lag bei 42 Minuten.',
  },
  {
    topic: 'Primärfarbe der Marke',
    content:
      'Die Primärfarbe 2026 ist Tiefblau #1B3A6B. Das Akzent-Türkis von 2025 ist ausgemustert und taucht in neuem Material nicht mehr auf.',
  },
  {
    topic: 'Onboarding-Kickoff-Fenster',
    content:
      'Jeder neue Kunde bekommt innerhalb von 3 Werktagen nach Vertragsschluss einen Kickoff-Termin. Der Arbeitsbereich steht vorher, gebrandet.',
  },
];

const DE_PRODUCTS: readonly DemoProduct[] = [
  {
    name: 'Analytics Pro — Jahreslizenz',
    description:
      'Komplette Analytics-Suite für einen Arbeitsbereich, jährlich abgerechnet.',
    price: '1188',
    currency: 'EUR',
    category: 'Lizenzen',
    status: 'active',
  },
  {
    name: 'Onboarding-Beschleuniger',
    description:
      'Zweiwöchige begleitete Einführung mit vorbereitetem gemeinsamem Projekt.',
    price: '1900',
    currency: 'EUR',
    category: 'Dienstleistungen',
    status: 'active',
  },
  {
    name: 'Team-Workshop',
    description: 'Halbtägiger Praxis-Workshop für bis zu zwölf Plätze.',
    price: '950',
    currency: 'EUR',
    stock: '12',
    category: 'Dienstleistungen',
    status: 'draft',
  },
];

const FR_PROJECTS: readonly DemoProject[] = [
  {
    name: 'Refonte du site web',
    tasks: [
      // Trigger titles created at staging time, like the German list above.
      { title: 'Auditer les scripts tiers', status: 'backlog' },
      {
        title: 'Finaliser les textes d’accueil avec le marketing',
        status: 'in_progress',
      },
      {
        title: 'Passer l’audit d’accessibilité sur le staging',
        status: 'in_review',
      },
      {
        title: 'Mapper les anciennes URL vers la nouvelle structure',
        status: 'done',
      },
      { title: 'Reconstruire l’ancienne page tarifs', status: 'cancelled' },
    ],
  },
  {
    name: 'Portail d’onboarding client',
    tasks: [
      { title: 'Concevoir l’écran de suivi de progression', status: 'todo' },
      {
        title: 'Brancher le webhook CRM des nouvelles inscriptions',
        status: 'todo',
      },
      {
        title: 'Rédiger la séquence d’e-mails de bienvenue',
        status: 'in_progress',
      },
      { title: 'Revoir le passage de l’essai à l’abonnement', status: 'done' },
    ],
  },
];

const FR_DOCUMENTS: readonly DemoDocument[] = [
  {
    fileName: 'revue-support-t2.txt',
    mimeType: 'text/plain',
    content: [
      '# Revue support du T2',
      '',
      'Le volume de tickets a augmenté de 12 % sur le trimestre ; la première',
      'réponse médiane tient à 42 minutes. Les trois premiers motifs :',
      'réinitialisations de mot de passe, configuration des webhooks et',
      'limites d’import CSV. Les questions webhooks ont doublé depuis la',
      'version d’avril — le guide mérite un exemple complet.',
    ].join('\n'),
  },
  {
    fileName: 'check-list-onboarding.txt',
    mimeType: 'text/plain',
    content: [
      '# Check-list d’onboarding client',
      '',
      '1. Appel de lancement planifié sous 3 jours après signature.',
      '2. Espace de travail créé et personnalisé avant l’appel.',
      '3. Premier projet partagé préparé avec des tâches d’exemple.',
      '4. Indicateurs de succès validés et inscrits au plan de compte.',
    ].join('\n'),
  },
  {
    fileName: 'charte-graphique-2026.txt',
    mimeType: 'text/plain',
    content: [
      '# Charte graphique Northlight Labs (2026)',
      '',
      '## Couleurs',
      'Primaire : bleu profond #1B3A6B. Le turquoise d’accent de 2025 est retiré.',
      '',
      '## Logo',
      'Espace de protection : 1x la hauteur du logo sur chaque côté.',
      '',
      '## Ton',
      'Registre direct, phrases courtes, pas de point d’exclamation.',
    ].join('\n'),
  },
];

const FR_KNOWLEDGE: readonly DemoKnowledgeEntry[] = [
  {
    topic: 'Objectif de première réponse support',
    content:
      'Le support vise une première réponse sous 45 minutes en heures ouvrées (lun–ven, 9:00–17:00 CET). La médiane du T2 : 42 minutes.',
  },
  {
    topic: 'Couleur primaire de la marque',
    content:
      'La primaire 2026 est le bleu profond #1B3A6B. Le turquoise d’accent de 2025 est retiré et ne doit plus apparaître.',
  },
  {
    topic: 'Fenêtre de lancement onboarding',
    content:
      'Chaque nouveau client a un appel de lancement sous 3 jours ouvrés après signature. L’espace de travail est prêt et personnalisé avant l’appel.',
  },
];

const FR_PRODUCTS: readonly DemoProduct[] = [
  {
    name: 'Analytics Pro — licence annuelle',
    description:
      'Suite analytique complète pour un espace de travail, facturée à l’année.',
    price: '1188',
    currency: 'EUR',
    category: 'Licences',
    status: 'active',
  },
  {
    name: 'Accélérateur d’onboarding',
    description:
      'Déploiement accompagné de deux semaines avec un projet partagé prêt à l’emploi.',
    price: '1900',
    currency: 'EUR',
    category: 'Services',
    status: 'active',
  },
  {
    name: 'Atelier de formation d’équipe',
    description: 'Atelier pratique d’une demi-journée, jusqu’à douze places.',
    price: '950',
    currency: 'EUR',
    stock: '12',
    category: 'Services',
    status: 'draft',
  },
];

const DE_TEAMS: readonly string[] = [
  'Wachstum',
  'Plattform-Engineering',
  'Kundenerfolg',
];

const FR_TEAMS: readonly string[] = [
  'Croissance',
  'Ingénierie plateforme',
  'Succès client',
];

const DE_PROJECT_FILES: readonly DemoDocument[] = [
  {
    fileName: 'relaunch-content-inventar.txt',
    mimeType: 'text/plain',
    content: [
      '# Relaunch-Content-Inventar',
      '',
      '380 alte URLs geprüft. 214 Seiten ziehen unverändert um, 126 gehen in',
      'der neuen Struktur auf, 40 schwach besuchte Blogartikel leiten auf die',
      'Blog-Übersicht um. Zuständigkeiten je Bereich stehen im Migrationsblatt.',
    ].join('\n'),
  },
  {
    fileName: 'launch-runbook.txt',
    mimeType: 'text/plain',
    content: [
      '# Launch-Runbook',
      '',
      '1. Content-Freeze um 08:00 — keine CMS-Änderungen bis zum Go-live.',
      '2. Deploy hinter dem Wartungs-Flag; Redirect-Map durchtesten.',
      '3. DNS-Umstellung um 10:00; Core Web Vitals eine Stunde beobachten.',
      '4. Rollback: vorherigen Build neu ausrollen, ein Schritt, kein Datenverlust.',
    ].join('\n'),
  },
];

const FR_PROJECT_FILES: readonly DemoDocument[] = [
  {
    fileName: 'inventaire-contenu-refonte.txt',
    mimeType: 'text/plain',
    content: [
      '# Inventaire de contenu — refonte',
      '',
      '380 anciennes URL auditées. 214 pages migrent telles quelles, 126',
      'fusionnent dans la nouvelle structure, 40 billets de blog à faible',
      'trafic redirigent vers l’index du blog. Les responsables par section',
      'sont dans la feuille de migration.',
    ].join('\n'),
  },
  {
    fileName: 'runbook-jour-j.txt',
    mimeType: 'text/plain',
    content: [
      '# Runbook du jour J',
      '',
      '1. Gel du contenu à 08:00 — aucune édition CMS avant la mise en ligne.',
      '2. Déploiement derrière le drapeau maintenance ; tester le plan de redirections.',
      '3. Bascule DNS à 10:00 ; surveiller les Core Web Vitals pendant une heure.',
      '4. Rollback : redéployer le build précédent, une étape, aucune perte de données.',
    ].join('\n'),
  },
];

const DE_MCP_SERVER = {
  name: 'internes-wiki',
  displayName: 'Internes Wiki',
  description:
    'Durchsucht das Engineering-Wiki und die Design-Entscheidungen von Nordlicht.',
  url: 'https://mcp.nordlicht.example/mcp',
} as const;

const FR_MCP_SERVER = {
  name: 'wiki-interne',
  displayName: 'Wiki interne',
  description:
    'Recherche dans le wiki d’ingénierie et les décisions de design d’Aurore.',
  url: 'https://mcp.aurore.example/mcp',
} as const;

const CONTENT: Record<Locale, VideoDemoContent> = {
  en: {
    projects: DEMO_PROJECTS,
    documents: DEMO_DOCUMENTS,
    knowledgeEntries: DEMO_KNOWLEDGE_ENTRIES,
    products: DEMO_PRODUCTS,
    teams: DEMO_TEAMS,
    mcpServer: DEMO_MCP_SERVER,
    projectFiles: DEMO_PROJECT_FILES,
    wowSourceDoc: 'q2-support-review.txt',
    stagedTasks: {
      green: 'Sign off the launch checklist',
      red: 'Prepare the rollback plan',
      suggested: 'Sign off the launch checklist',
    },
    boardReadyTask: 'Sign off the launch checklist',
    boardHoverTask: 'Finalize homepage copy with marketing',
  },
  de: {
    projects: DE_PROJECTS,
    documents: DE_DOCUMENTS,
    knowledgeEntries: DE_KNOWLEDGE,
    products: DE_PRODUCTS,
    teams: DE_TEAMS,
    mcpServer: DE_MCP_SERVER,
    projectFiles: DE_PROJECT_FILES,
    wowSourceDoc: 'q2-support-bericht.txt',
    stagedTasks: {
      green: 'Launch-Checkliste freigeben',
      red: 'Rollback-Plan vorbereiten',
      suggested: 'Go-live-Freigabe erteilen',
    },
    boardReadyTask: 'Launch-Checkliste freigeben',
    boardHoverTask: 'Startseiten-Texte mit Marketing abstimmen',
  },
  fr: {
    projects: FR_PROJECTS,
    documents: FR_DOCUMENTS,
    knowledgeEntries: FR_KNOWLEDGE,
    products: FR_PRODUCTS,
    teams: FR_TEAMS,
    mcpServer: FR_MCP_SERVER,
    projectFiles: FR_PROJECT_FILES,
    wowSourceDoc: 'revue-support-t2.txt',
    stagedTasks: {
      green: 'Valider la check-list de lancement',
      red: 'Préparer le plan de rollback',
      suggested: 'Donner le feu vert à la mise en ligne',
    },
    boardReadyTask: 'Valider la check-list de lancement',
    boardHoverTask: 'Finaliser les textes d’accueil avec le marketing',
  },
};

export function videoContentFor(locale: Locale): VideoDemoContent {
  return CONTENT[locale];
}
