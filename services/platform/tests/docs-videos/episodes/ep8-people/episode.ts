/**
 * Episode 8 — "People, roles & teams". The human half of the trust story:
 * the members table and the role ladder, the add-member dialog opened (and
 * deliberately NOT submitted — the ladder is the lesson), teams as knowledge
 * boundaries, and identity hygiene (2FA, SSO). Zero mutations; the locale
 * orgs carry seeded members and native team names.
 *
 * AI-literacy beat: least privilege is for people AND agents — access is
 * designed, not assumed, on both sides of the table.
 */

import type { EpisodeSpec } from '../../lib/episode';

export const EP8_PEOPLE: EpisodeSpec = {
  id: 'ep8-people',
  section: 'tutorials',
  titleByLocale: {
    en: 'People, roles & teams',
    de: 'Menschen, Rollen & Teams',
    fr: 'Personnes, rôles & équipes',
  },
  episodeLabelByLocale: {
    en: 'Episode 8',
    de: 'Episode 8',
    fr: 'Épisode 8',
  },
  needsKnowledgeDb: false,
  wholeTakeLocales: ['en'],
  voices: {
    en: 'WZlYpi1yf6zJhNWXih74',
    de: 'rKiu7lQ4c5P3az3745s3',
    fr: 'QbsdzCokdlo98elkq4Pc',
  },
  scenes: [
    {
      id: 'title',
      leadInMs: 1200,
      narration: {
        en: 'The machines got their gates in episode five. This episode is the human half: members, roles, and teams — who can build, who can run, and who gets to see what.',
        de: 'Die Maschinen bekamen ihre Tore in Episode fünf. Diese Episode ist die menschliche Hälfte: Mitglieder, Rollen und Teams — wer bauen darf, wer ausführen darf und wer was zu sehen bekommt.',
        fr: 'Les machines ont eu leurs portes à l’épisode cinq. Cet épisode est la moitié humaine : membres, rôles et équipes — qui peut construire, qui peut exécuter, et qui voit quoi.',
      },
    },
    {
      id: 'people',
      chapterByLocale: { en: 'People', de: 'Mitglieder', fr: 'Membres' },
      chapterTransition: 'cut',
      minMs: 13_000,
      narration: {
        en: 'Here is the workspace roster. Five people, and next to each name the role that decides their reach. This table is the org chart your AI actually obeys.',
        de: 'Hier ist die Besetzung des Arbeitsbereichs. Fünf Personen, und neben jedem Namen die Rolle, die ihre Reichweite bestimmt. Diese Tabelle ist das Organigramm, an das sich deine KI tatsächlich hält.',
        fr: 'Voici l’effectif de l’espace de travail. Cinq personnes, et à côté de chaque nom le rôle qui décide de sa portée. Cette table est l’organigramme que ton IA respecte réellement.',
      },
    },
    {
      id: 'invite',
      minMs: 17_000,
      narration: {
        en: 'Adding someone is a minute of work — name, email, and the decision that matters: the role. Member runs what exists. Editor builds agents and automations. Developer wires code and APIs. Admin holds providers and governance. We will leave the form here — the ladder is the lesson.',
        de: 'Jemanden hinzuzufügen dauert eine Minute — Name, E-Mail und die Entscheidung, auf die es ankommt: die Rolle. Member nutzen, was existiert. Editoren bauen Agenten und Automatisierungen. Developer verdrahten Code und APIs. Admins halten Anbieter und Richtlinien. Das Formular lassen wir hier stehen — die Leiter ist die Lektion.',
        fr: 'Ajouter quelqu’un prend une minute — nom, e-mail, et la décision qui compte : le rôle. Member utilise ce qui existe. Editor construit agents et automatisations. Developer câble code et API. Admin tient fournisseurs et gouvernance. On laisse le formulaire ici — l’échelle est la leçon.',
      },
    },
    {
      id: 'least-privilege',
      narration: {
        en: 'Notice the shape: most people never need more than Member. Roles are not status — they are blast radius. The fewer hands on the machinery, the easier every audit, every incident, every offboarding.',
        de: 'Sieh dir das Muster an: Die meisten brauchen nie mehr als Member. Rollen sind kein Status — sie sind Wirkungsradius. Je weniger Hände an der Maschinerie, desto leichter jedes Audit, jeder Vorfall, jedes Offboarding.',
        fr: 'Regarde la forme : la plupart des gens n’ont jamais besoin de plus que Member. Les rôles ne sont pas un statut — c’est un rayon d’action. Moins il y a de mains sur la machinerie, plus chaque audit, incident ou départ est simple.',
      },
    },
    {
      id: 'teams',
      chapterByLocale: { en: 'Teams', de: 'Teams', fr: 'Équipes' },
      chapterTransition: 'cut',
      minMs: 13_000,
      narration: {
        en: 'Teams draw the reading boundaries. Growth, engineering, customer success — each can hold its own documents and agents, and what is scoped to a team is invisible outside it. Episode three called it the smallest library; this is where the walls are built.',
        de: 'Teams ziehen die Lesegrenzen. Wachstum, Engineering, Kundenerfolg — jedes kann eigene Dokumente und Agenten halten, und was einem Team zugeordnet ist, bleibt außerhalb unsichtbar. Episode drei nannte es die kleinste Bibliothek; hier werden ihre Wände gebaut.',
        fr: 'Les équipes tracent les frontières de lecture. Croissance, ingénierie, succès client — chacune peut tenir ses documents et ses agents, et ce qui est réservé à une équipe reste invisible dehors. L’épisode trois parlait de la plus petite bibliothèque ; c’est ici qu’on monte ses murs.',
      },
    },
    {
      id: 'identity',
      minMs: 12_000,
      narration: {
        en: 'And under it all, identity hygiene: two-factor authentication for every account, enterprise single sign-on when your company already has one. Boring, decisive, and exactly where an attacker looks first.',
        de: 'Und darunter die Identitäts-Hygiene: Zwei-Faktor-Authentifizierung für jedes Konto, Enterprise-SSO, wenn eure Firma eines hat. Langweilig, entscheidend — und genau da, wo ein Angreifer zuerst hinschaut.',
        fr: 'Et en dessous de tout, l’hygiène d’identité : la double authentification pour chaque compte, le SSO d’entreprise quand votre société en a un. Ennuyeux, décisif — et exactement là où un attaquant regarde en premier.',
      },
    },
    {
      id: 'principle',
      narration: {
        en: 'Same principle, both sides of the table: episode four scoped the agents, this episode scopes the people. Access is designed, not assumed — and the workspace stays explainable because of it.',
        de: 'Dasselbe Prinzip auf beiden Seiten des Tisches: Episode vier hat die Agenten begrenzt, diese Episode die Menschen. Zugriff wird entworfen, nicht angenommen — und genau deshalb bleibt der Arbeitsbereich erklärbar.',
        fr: 'Même principe des deux côtés de la table : l’épisode quatre a borné les agents, celui-ci borne les personnes. L’accès se conçoit, il ne se présume pas — et c’est pour ça que l’espace reste explicable.',
      },
    },
    {
      id: 'recap',
      narration: {
        en: 'Members with the smallest sufficient role, teams as knowledge walls, identity done properly. Next episode — the finale: governance, cost, and trust, the whole control room in one tour.',
        de: 'Mitglieder mit der kleinsten ausreichenden Rolle, Teams als Wissenswände, Identität sauber gelöst. Nächste Episode — das Finale: Richtlinien, Kosten und Vertrauen, der ganze Kontrollraum in einer Tour.',
        fr: 'Des membres au plus petit rôle suffisant, des équipes comme murs de connaissances, une identité bien faite. Prochain épisode — le final : gouvernance, coûts et confiance, toute la salle de contrôle en une visite.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'Members, roles, and teams are covered in depth in the admin section of the documentation. See you in episode nine.',
        de: 'Mitglieder, Rollen und Teams behandelt der Admin-Bereich der Dokumentation in der Tiefe. Bis zur neunten Episode.',
        fr: 'Membres, rôles et équipes sont détaillés dans la section Admin de la documentation. À bientôt pour l’épisode neuf.',
      },
    },
  ],
} as const;
