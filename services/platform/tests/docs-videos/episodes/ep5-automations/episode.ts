/**
 * Episode 5 — "Automations & approvals". The installed triage automation
 * end to end (catalog → editor → triggers → executions, including the honest
 * red run), then the series' human-in-the-loop centerpiece: an agent drafts
 * an outbound customer reply, PAUSES on an approval card, and a person
 * decides on camera. The card is driven by the `request_human_input`
 * docs-reply tool script — a real pending approval, not a prop.
 *
 * AI-literacy beats: automation fails sometimes and a healthy system shows
 * where (the red run's journal); autonomy needs gates ("AI drafts, people
 * decide" — episode one's promise, now in the wiring).
 */

import type { EpisodeSpec, Locale } from '../../lib/episode';

/** What the reviewer types into the approval card's adjustments field. */
export const APPROVAL_FIELD_TEXT: Record<Locale, string> = {
  en: 'Looks good — send it as is.',
  de: 'Passt — bitte so senden.',
  fr: 'Parfait — envoie telle quelle.',
};

export const EP5_AUTOMATIONS: EpisodeSpec = {
  id: 'ep5-automations',
  section: 'tutorials',
  titleByLocale: {
    en: 'Automations & approvals',
    de: 'Automatisierungen & Freigaben',
    fr: 'Automatisations & validations',
  },
  episodeLabelByLocale: {
    en: 'Episode 5',
    de: 'Episode 5',
    fr: 'Épisode 5',
  },
  needsKnowledgeDb: true,
  wholeTakeLocales: ['en'],
  voices: {
    en: 'WZlYpi1yf6zJhNWXih74',
    de: 'rKiu7lQ4c5P3az3745s3',
    fr: 'QbsdzCokdlo98elkq4Pc',
  },
  /** The gated ask — pairs with the request_human_input docs-reply. */
  heroPromptByLocale: {
    en: 'Draft a reply to Bergmann Logistics about their annual discount question and send it to them.',
    de: 'Entwirf eine Antwort an Bergmann Logistics zur Frage nach dem Jahresrabatt und schick sie raus.',
    fr: 'Rédige une réponse à Bergmann Logistics sur la remise annuelle et envoie-la.',
  },
  scenes: [
    {
      id: 'title',
      leadInMs: 1200,
      narration: {
        en: 'Agents answer when you ask. Automations act on their own — on schedules, on events, on incoming work. This episode: how they run, how they fail honestly, and the card that keeps a person in charge.',
        de: 'Agenten antworten, wenn du fragst. Automatisierungen handeln von selbst — nach Zeitplan, auf Ereignisse, bei eingehender Arbeit. In dieser Episode: wie sie laufen, wie sie ehrlich scheitern und welche Karte einen Menschen am Steuer hält.',
        fr: 'Les agents répondent quand tu demandes. Les automatisations agissent seules — sur planning, sur événements, sur le travail qui arrive. Dans cet épisode : comment elles tournent, comment elles échouent honnêtement, et la carte qui garde un humain aux commandes.',
      },
    },
    {
      id: 'catalog',
      chapterByLocale: {
        en: 'Automations',
        de: 'Automatisierungen',
        fr: 'Automatisations',
      },
      leadInMs: 900,
      minMs: 13_000,
      narration: {
        en: 'The catalog is a library of ready-made bundles: sync a mailbox, resolve GitHub issues, keep documents indexed. Each one packs workflows, agents, and views — one install, and it files itself into your workspace.',
        de: 'Der Katalog ist eine Bibliothek fertiger Pakete: ein Postfach synchronisieren, GitHub-Issues lösen, Dokumente indexiert halten. Jedes bündelt Workflows, Agenten und Ansichten — eine Installation, und es richtet sich selbst ein.',
        fr: 'Le catalogue est une bibliothèque de lots prêts à l’emploi : synchroniser une boîte mail, résoudre des issues GitHub, garder les documents indexés. Chacun regroupe workflows, agents et vues — une installation, et il se range tout seul.',
      },
    },
    {
      id: 'installed',
      minMs: 11_000,
      narration: {
        en: 'This workspace already runs one: task triage. Every new task gets scored, and the automation decides — assign it to an agent, or leave a suggestion for a human. Let us open it up.',
        de: 'Dieser Arbeitsbereich betreibt schon eine: die Aufgaben-Triage. Jede neue Aufgabe wird bewertet, und die Automatisierung entscheidet — einem Agenten zuweisen oder einen Vorschlag für einen Menschen hinterlassen. Schauen wir hinein.',
        fr: 'Cet espace en fait déjà tourner une : le triage des tâches. Chaque nouvelle tâche reçoit un score, et l’automatisation décide — l’assigner à un agent, ou laisser une suggestion à un humain. Ouvrons-la.',
      },
    },
    {
      id: 'editor',
      chapterByLocale: {
        en: 'The workflow',
        de: 'Der Workflow',
        fr: 'Le workflow',
      },
      chapterTransition: 'cut',
      minMs: 12_000,
      narration: {
        en: 'Inside, the automation reads like a recipe: a trigger, then steps. A step scores the task with an agent, a step routes it, a step reports. No black box — you can read exactly what will happen before it ever runs.',
        de: 'Innen liest sich die Automatisierung wie ein Rezept: ein Auslöser, dann Schritte. Ein Schritt bewertet die Aufgabe mit einem Agenten, einer leitet sie weiter, einer berichtet. Keine Blackbox — du kannst genau lesen, was passieren wird, bevor es je läuft.',
        fr: 'À l’intérieur, l’automatisation se lit comme une recette : un déclencheur, puis des étapes. Une étape note la tâche avec un agent, une la route, une rend compte. Pas de boîte noire — tu peux lire exactement ce qui va se passer avant la première exécution.',
      },
    },
    {
      id: 'executions',
      chapterByLocale: { en: 'Runs', de: 'Läufe', fr: 'Exécutions' },
      chapterTransition: 'cut',
      minMs: 12_000,
      narration: {
        en: 'Every run leaves a journal. Green rows completed; each one lists what the trigger saw, what each step did, what it cost. Automation you can audit is automation you can trust.',
        de: 'Jeder Lauf hinterlässt ein Protokoll. Grüne Zeilen sind abgeschlossen; jede zeigt, was der Auslöser sah, was jeder Schritt tat und was er gekostet hat. Automatisierung, die du prüfen kannst, ist Automatisierung, der du trauen kannst.',
        fr: 'Chaque exécution laisse un journal. Les lignes vertes sont terminées ; chacune montre ce que le déclencheur a vu, ce que chaque étape a fait, ce que ça a coûté. Une automatisation qu’on peut auditer est une automatisation qu’on peut croire.',
      },
    },
    {
      id: 'failure',
      minMs: 12_000,
      narration: {
        en: 'And here is the row that matters most: a red one. A step returned data that failed validation, the run stopped, and the journal says exactly where. Automations fail sometimes — the difference between a toy and a tool is whether the failure has an address.',
        de: 'Und hier die wichtigste Zeile: eine rote. Ein Schritt lieferte Daten, die die Validierung nicht bestanden, der Lauf stoppte, und das Protokoll sagt genau, wo. Automatisierungen scheitern manchmal — der Unterschied zwischen Spielzeug und Werkzeug ist, ob das Scheitern eine Adresse hat.',
        fr: 'Et voici la ligne qui compte le plus : une rouge. Une étape a renvoyé des données refusées à la validation, l’exécution s’est arrêtée, et le journal dit exactement où. Les automatisations échouent parfois — la différence entre un jouet et un outil, c’est que l’échec ait une adresse.',
      },
    },
    {
      id: 'approval',
      chapterByLocale: { en: 'Approvals', de: 'Freigaben', fr: 'Validations' },
      // Rail to chat + ask + card + typed decision + submit + ack stream.
      minMs: 26_000,
      narration: {
        en: 'Now the centerpiece. We ask for a customer reply — drafted AND sent. The agent writes the draft… and stops. This card is the boundary: the draft is ready, but touching the outside world needs a person. We read it, we decide, we approve.',
        de: 'Jetzt das Herzstück. Wir bitten um eine Kundenantwort — entworfen UND versendet. Der Agent schreibt den Entwurf … und hält an. Diese Karte ist die Grenze: Der Entwurf steht, aber der Schritt nach draußen braucht einen Menschen. Wir lesen, wir entscheiden, wir geben frei.',
        fr: 'Maintenant, la pièce maîtresse. On demande une réponse client — rédigée ET envoyée. L’agent écrit le brouillon… et s’arrête. Cette carte est la frontière : le brouillon est prêt, mais toucher le monde extérieur demande une personne. On lit, on décide, on valide.',
      },
    },
    {
      id: 'principle',
      narration: {
        en: 'AI drafts, people decide — episode one made the promise, this is the wiring. And notice what approvals really buy you: not less automation, but more. You can afford to automate the risky work precisely because the risky step waits for you.',
        de: 'KI entwirft, Menschen entscheiden — Episode eins gab das Versprechen, hier ist die Verdrahtung. Und sieh, was Freigaben wirklich kaufen: nicht weniger Automatisierung, sondern mehr. Du kannst dir gerade deshalb leisten, riskante Arbeit zu automatisieren, weil der riskante Schritt auf dich wartet.',
        fr: 'L’IA rédige, les humains décident — l’épisode un a fait la promesse, voici le câblage. Et regarde ce que les validations t’offrent vraiment : pas moins d’automatisation, mais plus. Tu peux te permettre d’automatiser le travail risqué précisément parce que l’étape risquée t’attend.',
      },
    },
    {
      id: 'recap',
      narration: {
        en: 'Automations: readable recipes, honest journals, and a human gate on the steps that matter. Next episode: projects — where your team and its agents share one board.',
        de: 'Automatisierungen: lesbare Rezepte, ehrliche Protokolle und ein menschliches Tor vor den Schritten, die zählen. Nächste Episode: Projekte — wo dein Team und seine Agenten ein Board teilen.',
        fr: 'Les automatisations : des recettes lisibles, des journaux honnêtes, et une porte humaine sur les étapes qui comptent. Prochain épisode : les projets — où ton équipe et ses agents partagent un même tableau.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'The automations and approvals sections of the documentation carry the full reference. See you in episode six.',
        de: 'Die Bereiche Automatisierungen und Freigaben der Dokumentation tragen die volle Referenz. Bis zur sechsten Episode.',
        fr: 'Les sections Automatisations et Validations de la documentation portent la référence complète. À bientôt pour l’épisode six.',
      },
    },
  ],
} as const;
