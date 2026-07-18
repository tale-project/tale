/**
 * Episode 7 — "Integrations & the outside world". The doors out of the
 * workspace: the integrations catalog and the connected Tavily connector
 * (operations + allowed hosts readable before anything runs), the deep-
 * research payoff from episode two, MCP servers with per-tool approval
 * flags, and the sandbox egress posture. All read-only surfaces — the
 * discipline is the story.
 *
 * AI-literacy beat: every connection is a door — documented operations,
 * named hosts, approval flags, default-deny networks. Open doors
 * deliberately.
 */

import type { EpisodeSpec } from '../../lib/episode';

export const EP7_INTEGRATIONS: EpisodeSpec = {
  id: 'ep7-integrations',
  section: 'tutorials',
  titleByLocale: {
    en: 'Integrations & the outside world',
    de: 'Integrationen & die Außenwelt',
    fr: 'Intégrations & le monde extérieur',
  },
  episodeLabelByLocale: {
    en: 'Episode 7',
    de: 'Episode 7',
    fr: 'Épisode 7',
  },
  needsKnowledgeDb: false,
  wholeTakeLocales: ['en'],
  voices: {
    en: 'WZlYpi1yf6zJhNWXih74',
    de: 'rKiu7lQ4c5P3az3745s3',
    fr: 'QbsdzCokdlo98elkq4Pc',
  },
  /** No live chat ask in this episode. */
  scenes: [
    {
      id: 'title',
      leadInMs: 1200,
      narration: {
        en: 'Your workspace does not live alone. Mail, repositories, search, your own internal tools — this episode walks the doors to the outside world, and the discipline built into each one.',
        de: 'Dein Arbeitsbereich lebt nicht allein. E-Mail, Repositories, Suche, eure internen Werkzeuge — diese Episode geht die Türen zur Außenwelt ab, und die Disziplin, die in jeder steckt.',
        fr: 'Ton espace de travail ne vit pas seul. Le mail, les dépôts, la recherche, vos outils internes — cet épisode parcourt les portes vers l’extérieur, et la discipline logée dans chacune.',
      },
    },
    {
      id: 'catalog',
      chapterByLocale: {
        en: 'Integrations',
        de: 'Integrationen',
        fr: 'Intégrations',
      },
      chapterTransition: 'cut',
      minMs: 14_000,
      narration: {
        en: 'Integrations connect once and serve the whole workspace: Gmail, GitHub, Shopify, Slack — and Tavily, already live here. Every agent and automation borrows the same connection; nobody pastes keys into prompts.',
        de: 'Integrationen verbinden sich einmal und dienen dem ganzen Arbeitsbereich: Gmail, GitHub, Shopify, Slack — und Tavily, hier schon aktiv. Jeder Agent und jede Automatisierung leiht sich dieselbe Verbindung; niemand klebt Schlüssel in Prompts.',
        fr: 'Les intégrations se connectent une fois et servent tout l’espace : Gmail, GitHub, Shopify, Slack — et Tavily, déjà active ici. Chaque agent et chaque automatisation emprunte la même connexion ; personne ne colle de clés dans les prompts.',
      },
    },
    {
      id: 'connector',
      minMs: 14_000,
      narration: {
        en: 'Open a connector and you can read the door before you open it: exactly two operations — search and extract — and an allowed-hosts list naming where requests may go. No hidden verbs, no surprise destinations.',
        de: 'Öffne einen Connector, und du kannst die Tür lesen, bevor du sie öffnest: genau zwei Operationen — Suchen und Extrahieren — und eine Liste erlaubter Hosts, die benennt, wohin Anfragen dürfen. Keine versteckten Verben, keine Überraschungsziele.',
        fr: 'Ouvre un connecteur et tu peux lire la porte avant de l’ouvrir : exactement deux opérations — chercher et extraire — et une liste d’hôtes autorisés qui nomme où les requêtes peuvent aller. Pas de verbes cachés, pas de destinations surprises.',
      },
    },
    {
      id: 'payoff',
      minMs: 13_000,
      narration: {
        en: 'And here is what a connection buys: remember deep research from episode two? It exists in this workspace because Tavily is bound. Connect a door once, and a whole capability lights up for everyone.',
        de: 'Und das kauft dir eine Verbindung: Erinnerst du dich an die Tiefenrecherche aus Episode zwei? Es gibt sie in diesem Arbeitsbereich, weil Tavily angebunden ist. Verbinde eine Tür einmal, und eine ganze Fähigkeit leuchtet für alle auf.',
        fr: 'Et voilà ce qu’une connexion apporte : tu te souviens de la recherche approfondie de l’épisode deux ? Elle existe dans cet espace parce que Tavily est reliée. Connecte une porte une fois, et toute une capacité s’allume pour tout le monde.',
      },
    },
    {
      id: 'mcp',
      chapterByLocale: {
        en: 'MCP servers',
        de: 'MCP-Server',
        fr: 'Serveurs MCP',
      },
      chapterTransition: 'cut',
      minMs: 14_000,
      narration: {
        en: 'For everything without a ready-made connector, there is MCP — the open protocol for tools. Point Tale at your internal wiki, your ticket system, anything that speaks it, and its tools appear to your agents like native ones.',
        de: 'Für alles ohne fertigen Connector gibt es MCP — das offene Protokoll für Werkzeuge. Richte Tale auf euer internes Wiki, euer Ticketsystem, alles, was es spricht — und seine Werkzeuge erscheinen deinen Agenten wie eingebaute.',
        fr: 'Pour tout ce qui n’a pas de connecteur prêt, il y a MCP — le protocole ouvert des outils. Pointe Tale vers votre wiki interne, votre système de tickets, tout ce qui le parle — et ses outils apparaissent à tes agents comme des natifs.',
      },
    },
    {
      id: 'flags',
      narration: {
        en: 'But native-looking is not native-trusted. An external tool is a new trust boundary, and each one carries its own approval flag — flip it, and every call waits for a person, exactly like the card in episode five.',
        de: 'Aber eingebaut aussehen heißt nicht eingebaut vertrauen. Ein externes Werkzeug ist eine neue Vertrauensgrenze, und jedes trägt sein eigenes Freigabe-Flag — leg es um, und jeder Aufruf wartet auf einen Menschen, genau wie die Karte in Episode fünf.',
        fr: 'Mais avoir l’air natif n’est pas être digne de confiance native. Un outil externe est une nouvelle frontière de confiance, et chacun porte son drapeau de validation — active-le, et chaque appel attend une personne, exactement comme la carte de l’épisode cinq.',
      },
    },
    {
      id: 'egress',
      chapterByLocale: { en: 'Boundaries', de: 'Grenzen', fr: 'Frontières' },
      chapterTransition: 'cut',
      minMs: 13_000,
      narration: {
        en: 'The last door is the one code opens. When agents run code, it runs in a sandbox whose network is closed by default — allowed destinations are named, everything else is refused, and the policy fails closed. A tool that cannot phone home quietly is a tool you can afford to run.',
        de: 'Die letzte Tür öffnet der Code. Wenn Agenten Code ausführen, läuft er in einer Sandbox, deren Netz standardmäßig zu ist — erlaubte Ziele sind benannt, alles andere wird verweigert, und die Richtlinie schließt im Zweifel. Ein Werkzeug, das nicht heimlich nach Hause telefonieren kann, kannst du dir leisten.',
        fr: 'La dernière porte, c’est le code qui l’ouvre. Quand les agents exécutent du code, il tourne dans un bac à sable au réseau fermé par défaut — les destinations autorisées sont nommées, tout le reste est refusé, et la politique échoue fermée. Un outil qui ne peut pas téléphoner en douce est un outil qu’on peut se permettre.',
      },
    },
    {
      id: 'principle',
      narration: {
        en: 'That is the pattern at every door: operations you can read, hosts you can name, approvals you can require, networks that default to no. Connect boldly — because each door was built to be opened deliberately.',
        de: 'Das ist das Muster an jeder Tür: Operationen zum Nachlesen, Hosts mit Namen, Freigaben nach Bedarf, Netze, die im Zweifel Nein sagen. Verbinde mutig — denn jede Tür ist dafür gebaut, bewusst geöffnet zu werden.',
        fr: 'C’est le motif à chaque porte : des opérations lisibles, des hôtes nommés, des validations exigibles, des réseaux qui disent non par défaut. Connecte sans crainte — chaque porte est faite pour être ouverte délibérément.',
      },
    },
    {
      id: 'recap',
      narration: {
        en: 'Integrations, MCP, and the boundaries that make them safe to use. Next episode: the people side — members, roles, and teams, and who gets to see what.',
        de: 'Integrationen, MCP und die Grenzen, die sie sicher nutzbar machen. Nächste Episode: die Menschen-Seite — Mitglieder, Rollen und Teams, und wer was sehen darf.',
        fr: 'Les intégrations, MCP, et les frontières qui les rendent sûres. Prochain épisode : le côté humain — membres, rôles et équipes, et qui voit quoi.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'The integrations and governance sections of the documentation carry every detail. See you in episode eight.',
        de: 'Die Bereiche Integrationen und Richtlinien der Dokumentation tragen jedes Detail. Bis zur achten Episode.',
        fr: 'Les sections Intégrations et Gouvernance de la documentation portent chaque détail. À bientôt pour l’épisode huit.',
      },
    },
  ],
} as const;
