/**
 * Episode 10 — "Bonus: Tale for developers". The builder's lap: scoped API
 * keys, the API surfaces (REST, MCP, WebDAV), webhook triggers on agents,
 * external external agents working in sandboxes, and the run-code policy that
 * keeps package installs and network egress contained. Closes the series.
 *
 * AI-literacy beat: power tools in a contained blast radius — scoped keys,
 * sandboxes, default-deny networks.
 */

import type { EpisodeSpec } from '../../lib/episode';

export const EP10_DEVELOPERS: EpisodeSpec = {
  id: 'ep10-developers',
  section: 'tutorials',
  titleByLocale: {
    en: 'Bonus: Tale for developers',
    de: 'Bonus: Tale für Entwickler',
    fr: 'Bonus : Tale pour les développeurs',
  },
  episodeLabelByLocale: {
    en: 'Bonus episode',
    de: 'Bonus-Episode',
    fr: 'Épisode bonus',
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
        en: 'A bonus lap for the builders. Everything the series showed has an API underneath — this episode walks the developer surface: keys, webhooks, external agents, and the sandbox that contains them.',
        de: 'Eine Bonusrunde für die Bauenden. Alles, was die Serie gezeigt hat, trägt eine API darunter — diese Episode geht die Entwickler-Oberfläche ab: Schlüssel, Webhooks, Coding-Agenten und die Sandbox, die sie einhegt.',
        fr: 'Un tour bonus pour celles et ceux qui construisent. Tout ce que la série a montré repose sur une API — cet épisode parcourt la surface développeur : clés, webhooks, agents de code, et le bac à sable qui les contient.',
      },
    },
    {
      id: 'api-keys',
      chapterByLocale: { en: 'API keys', de: 'API-Schlüssel', fr: 'Clés API' },
      chapterTransition: 'cut',
      minMs: 12_000,
      narration: {
        en: 'Programmatic access starts here: named keys, one per system — the ingest pipeline, the CI job. Each is scoped, revocable in one click, and every call it makes lands in the same audit log you saw in the finale.',
        de: 'Programmatischer Zugriff beginnt hier: benannte Schlüssel, einer pro System — die Ingest-Pipeline, der CI-Job. Jeder ist begrenzt, mit einem Klick widerrufbar, und jeder seiner Aufrufe landet im selben Audit-Protokoll aus dem Finale.',
        fr: 'L’accès programmatique commence ici : des clés nommées, une par système — la pipeline d’ingestion, le job de CI. Chacune est bornée, révocable en un clic, et chacun de ses appels atterrit dans le même journal d’audit que le final.',
      },
    },
    {
      id: 'surfaces',
      minMs: 13_000,
      narration: {
        en: 'Four doors for four styles: a REST API for everything the UI does, MCP to serve Tale’s tools to other agents, WebDAV to mount workspace files like a drive, and sandbox runtimes you can configure per language.',
        de: 'Vier Türen für vier Stile: eine REST-API für alles, was die Oberfläche kann, MCP, um Tales Werkzeuge anderen Agenten zu servieren, WebDAV, um Arbeitsbereich-Dateien wie ein Laufwerk einzubinden, und Sandbox-Runtimes, konfigurierbar pro Sprache.',
        fr: 'Quatre portes pour quatre styles : une API REST pour tout ce que fait l’interface, MCP pour servir les outils de Tale à d’autres agents, WebDAV pour monter les fichiers comme un disque, et des runtimes bac à sable configurables par langage.',
      },
    },
    {
      id: 'webhooks',
      chapterByLocale: { en: 'Webhooks', de: 'Webhooks', fr: 'Webhooks' },
      chapterTransition: 'cut',
      minMs: 13_000,
      narration: {
        en: 'Webhooks point the other way: any system can fire an agent. A signed POST from your CRM, your monitoring, your build — and the agent runs with the payload as context. The automations from episode five, triggered from anywhere.',
        de: 'Webhooks zeigen in die andere Richtung: Jedes System kann einen Agenten auslösen. Ein signierter POST aus eurem CRM, eurem Monitoring, eurem Build — und der Agent läuft mit der Payload als Kontext. Die Automatisierungen aus Episode fünf, ausgelöst von überall.',
        fr: 'Les webhooks pointent dans l’autre sens : n’importe quel système peut déclencher un agent. Un POST signé depuis votre CRM, votre monitoring, votre build — et l’agent tourne avec la charge utile comme contexte. Les automatisations de l’épisode cinq, déclenchées de partout.',
      },
    },
    {
      id: 'external-agents',
      chapterByLocale: {
        en: 'External agents',
        de: 'Coding-Agenten',
        fr: 'Agents de code',
      },
      chapterTransition: 'cut',
      minMs: 14_000,
      narration: {
        en: 'And the heavy machinery: external external agents — Claude Code, Cursor, and their peers — work inside Tale in their own sandboxes. They plan, write files, run commands… inside a box that starts empty and stays disconnected except for what the policy allows.',
        de: 'Und das schwere Gerät: externe Coding-Agenten — Claude Code, Cursor und ihre Kollegen — arbeiten in Tale in eigenen Sandboxes. Sie planen, schreiben Dateien, führen Befehle aus … in einer Box, die leer startet und getrennt bleibt, bis auf das, was die Richtlinie erlaubt.',
        fr: 'Et l’artillerie lourde : les agents de code externes — Claude Code, Cursor et leurs pairs — travaillent dans Tale dans leurs propres bacs à sable. Ils planifient, écrivent des fichiers, lancent des commandes… dans une boîte qui démarre vide et reste déconnectée, sauf ce que la politique autorise.',
      },
    },
    {
      id: 'run-code-policy',
      minMs: 13_000,
      narration: {
        en: 'That policy is explicit and yours: which packages may install, which hosts code may reach. Cloud metadata and private ranges are always refused, and when the egress proxy is down, nothing gets out — the system fails closed, never open.',
        de: 'Diese Richtlinie ist explizit und gehört euch: welche Pakete installiert werden dürfen, welche Hosts Code erreichen darf. Cloud-Metadaten und private Netzbereiche sind immer verweigert, und fällt der Egress-Proxy aus, kommt nichts hinaus — das System schließt im Fehlerfall, es öffnet nie.',
        fr: 'Cette politique est explicite et vous appartient : quels paquets peuvent s’installer, quels hôtes le code peut atteindre. Les métadonnées cloud et les plages privées sont toujours refusées, et si le proxy de sortie tombe, rien ne sort — le système échoue fermé, jamais ouvert.',
      },
    },
    {
      id: 'principle',
      narration: {
        en: 'Power tools, contained blast radius — the developer version of everything this series taught. Scope the key, sign the webhook, sandbox the agent, and build boldly inside those lines.',
        de: 'Starke Werkzeuge, eingehegter Wirkungsradius — die Entwickler-Fassung von allem, was diese Serie gelehrt hat. Begrenze den Schlüssel, signiere den Webhook, sperre den Agenten in die Sandbox — und bau mutig innerhalb dieser Linien.',
        fr: 'Des outils puissants, un rayon d’action contenu — la version développeur de tout ce que la série a enseigné. Borne la clé, signe le webhook, mets l’agent en bac à sable — et construis sans peur à l’intérieur de ces lignes.',
      },
    },
    {
      id: 'recap',
      narration: {
        en: 'That was the series — all ten episodes. The develop section of the documentation takes over from here: API reference, webhook signatures, and the contributor guide. Build something good.',
        de: 'Das war die Serie — alle zehn Episoden. Ab hier übernimmt der Develop-Bereich der Dokumentation: API-Referenz, Webhook-Signaturen und der Contributor-Guide. Bau etwas Gutes.',
        fr: 'C’était la série — dix épisodes. La section Develop de la documentation prend le relais : référence API, signatures de webhooks et guide du contributeur. Construis quelque chose de bien.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'Thanks for building with Tale.',
        de: 'Danke, dass du mit Tale baust.',
        fr: 'Merci de construire avec Tale.',
      },
    },
  ],
} as const;
