/**
 * Episode 7 — "Connectors & the outside world", the in-depth guide. The
 * viewer CONNECTS a system on camera: reads the GitHub connector like a
 * contract first (19 operations, 8 writes flagged for approval, one allowed
 * host), pastes a token and watches Connect verify it live against the API
 * before anything persists (the pitfall, located: a wrong token fails on
 * the panel, unsaved), finds the connection under the Connected tab, stages
 * an MCP server in the add dialog without saving it. Verify: the Connected tab lists GitHub beside Tavily —
 * that row is the episode's artifact.
 *
 * Register (produce-video STORYBOARD.md): a colleague showing you at your
 * desk — TUTORIAL GRAMMAR (signpost → action → observation → meaning) and
 * silence-led pacing: generous lead-ins after each chapter card, a tail
 * beat after every landed point, minMs floors carrying the typing work.
 *
 * The on-camera GitHub connection is a PERSISTENT org mutation the cleanup
 * registry has no type for — the coordinator sweeps it off camera
 * (Connected tab → GitHub panel → Disconnect → confirm; then Delete
 * connector for the seeded state). The connect scene is check-then-act:
 * an already-connected retake records a degraded fallback instead of
 * double-connecting.
 */

import type { EpisodeSpec, Locale } from '../../lib/episode';

/**
 * The token typed into the connector's credential field — scene DATA, one
 * ASCII literal for every locale. Outbound GitHub HTTP is rewritten to the
 * mock gateway, so the value is arbitrary and nothing leaves the machine.
 */
export const GITHUB_TOKEN = 'ghp_docs-demo-mock-token';

/** The add-MCP-server dialog draft — filled on camera, NEVER saved. The
 * name is an ASCII slug (same everywhere, like ep4's agent slug). */
export const MCP_DRAFT_NAME = 'support-tickets';

/** The draft server URL, on each locale org's fictional brand domain. */
export const MCP_DRAFT_URL: Record<Locale, string> = {
  en: 'https://mcp.northlight.example/support',
  de: 'https://mcp.nordlicht.example/support',
  fr: 'https://mcp.aurore.example/support',
};

export const EP7_CONNECTORS: EpisodeSpec = {
  id: 'ep7-connectors',
  section: 'tutorials',
  titleByLocale: {
    en: 'Connectors & the outside world',
    de: 'Connectoren & die Außenwelt',
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
  /** No live chat ask in this episode — the proof surfaces are settings. */
  scenes: [
    {
      // Cold open over the END STATE surface: the Connected tab the new
      // GitHub row will land in. The card lifts BEFORE the voice names it.
      id: 'title',
      leadInMs: 1600,
      tailMs: 1500,
      minMs: 27_000,
      narration: {
        en: 'Welcome to episode seven. Today your workspace reaches the outside world — safely. You’ll read a connector before trusting it, connect GitHub with a real token, stage an internal tool over MCP, and check what code may install. We’ll go step by step. This page — the Connected tab of your connectors — is where we’ll end up: one more connection, made by you.',
        de: 'Willkommen zu Episode sieben. Heute verbinden wir deinen Arbeitsbereich mit der Außenwelt — auf die sichere Art. Du liest einen Connector, bevor du ihm vertraust, verbindest GitHub mit einem echten Token, legst ein internes Tool über MCP an und prüfst, was Code installieren darf. Wir gehen Schritt für Schritt vor. Diese Seite — der Tab Verbunden deiner Connectoren — ist unser Ziel: eine Verbindung mehr, hergestellt von dir.',
        fr: 'Bienvenue dans l’épisode sept. Aujourd’hui, ton espace de travail s’ouvre sur l’extérieur — proprement. Tu vas lire un connecteur avant de lui faire confiance, connecter GitHub avec un vrai token, préparer un outil interne via MCP, et vérifier ce que le code a le droit d’installer. On avance étape par étape. Cette page — l’onglet Connectées de tes intégrations — c’est notre destination : une connexion de plus, faite par toi.',
      },
    },
    {
      // Context: what already exists — the one live connection, shared.
      id: 'context',
      leadInMs: 1200,
      tailMs: 1600,
      minMs: 19_000,
      narration: {
        en: 'Here’s what already exists. One connection is live: Tavily, the search service — you can tell by the Connected badge. Every agent in this workspace borrows that single connection; nobody pastes keys into prompts. Today we add a second one: GitHub.',
        de: 'Schau erst, was schon da ist. Eine Verbindung ist aktiv: Tavily, der Suchdienst — zu erkennen am Badge Verbunden. Jeder Agent im Arbeitsbereich leiht sich diese eine Verbindung; niemand klebt Schlüssel in Prompts. Heute kommt eine zweite dazu: GitHub.',
        fr: 'Voici ce qui existe déjà. Une connexion est active : Tavily, le service de recherche — le badge Connectée le montre. Chaque agent de cet espace emprunte cette connexion unique ; personne ne colle de clés dans les prompts. Aujourd’hui, on en ajoute une deuxième : GitHub.',
      },
    },
    {
      // Task 1 opens: the catalog on the All tab, GitHub found.
      id: 'catalog',
      chapterByLocale: {
        en: 'Before you connect',
        de: 'Vor dem Verbinden',
        fr: 'Avant de connecter',
      },
      leadInMs: 1400,
      tailMs: 1500,
      minMs: 20_000,
      narration: {
        en: 'First, where connectors come from. We switch to All connectors… and this is the catalog: Gmail, Slack, Shopify — ready-made, one connection each, shared by the whole workspace. And here’s GitHub. Before we connect it, let’s read what it’s actually allowed to do.',
        de: 'Zuerst: Woher kommen Connectoren? Wir wechseln auf Alle Connectoren … das ist der Katalog: Gmail, Slack, Shopify — fertig gebaut, eine Verbindung pro Dienst, geteilt vom ganzen Arbeitsbereich. Und hier: GitHub. Bevor wir verbinden, lesen wir nach, was er überhaupt darf.',
        fr: 'D’abord, d’où viennent les connecteurs. On passe sur Toutes les intégrations… voici le catalogue : Gmail, Slack, Shopify — prêts à l’emploi, une connexion par service, partagée par tout l’espace. Et voilà GitHub. Avant de le connecter, lisons ce qu’il a vraiment le droit de faire.',
      },
    },
    {
      // The connector read like a contract: 19 operations, 8 flagged writes.
      id: 'operations',
      leadInMs: 1000,
      tailMs: 1800,
      minMs: 27_000,
      narration: {
        en: 'We open the GitHub card… and get a panel you can read like a contract. Nineteen operations, every one named. Most of them read: list repositories, get an issue, search code. Eight of them write — create an issue, merge a pull request — and the connector flags every write to wait for a person’s approval, like the email you approved in episode five.',
        de: 'Wir öffnen die GitHub-Karte … und bekommen ein Panel, das du wie einen Vertrag liest. Neunzehn Operationen, jede benannt. Die meisten lesen nur: Repositories auflisten, ein Issue holen, Code durchsuchen. Acht davon schreiben — Issue erstellen, Pull Request mergen — und jede Schreib-Operation ist im Connector markiert: Sie wartet erst auf eine Freigabe, wie die E-Mail in Episode fünf.',
        fr: 'On ouvre la carte GitHub… et le panneau se lit comme un contrat. Dix-neuf opérations, chacune nommée. La plupart ne font que lire : lister les dépôts, récupérer une issue, chercher dans le code. Huit écrivent — créer une issue, merger une pull request — et le connecteur marque chaque écriture : elle attend d’abord une validation, comme l’e-mail que tu as validé dans l’épisode cinq.',
      },
    },
    {
      // Allowed hosts: where requests may go — read before any key exists.
      id: 'hosts',
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 17_000,
      narration: {
        en: 'Below the operations: Allowed hosts. Requests from this connector can reach api.github.com — and nowhere else. So before we’ve pasted anything, we know what GitHub here may do, and where it may talk. Now let’s connect it.',
        de: 'Unter den Operationen: Erlaubte Hosts. Anfragen aus diesem Connector erreichen api.github.com — und sonst nichts. Bevor wir irgendetwas eingefügt haben, wissen wir also, was GitHub hier darf und wohin es sprechen kann. Jetzt verbinden wir.',
        fr: 'Sous les opérations : Hôtes autorisés. Les requêtes de ce connecteur atteignent api.github.com — et rien d’autre. Avant d’avoir collé quoi que ce soit, tu sais donc ce que GitHub peut faire ici, et à qui il peut parler. Maintenant, connectons-le.',
      },
    },
    {
      // Task 2, the centerpiece: the token in, Connect verifying it live.
      // The pitfall is LOCATED here: a wrong token fails on this panel,
      // before anything persists (on-camera failure is impossible against
      // the mock — it accepts any bearer; see the report's rehearsal risks).
      id: 'connect',
      chapterByLocale: {
        en: 'Connect it',
        de: 'Verbinden',
        fr: 'Connecter',
      },
      leadInMs: 2000,
      tailMs: 1600,
      minMs: 32_000,
      narration: {
        en: 'The panel asks for one thing: a personal access token — you’d create that in GitHub’s developer settings. We click the field… and paste ours in. Notice it stays masked — this key is a secret, and it’s treated as one. And one thing worth knowing: Connect doesn’t just store the token. It calls GitHub’s API first — a wrong token fails right here on this panel, and nothing gets saved. Ours is right, so… Connect GitHub.',
        de: 'Das Panel will genau eines: einen Personal Access Token — den erstellst du in den Entwickler-Einstellungen von GitHub. Wir klicken ins Feld … und fügen unseren ein. Er bleibt maskiert — dieser Schlüssel ist ein Geheimnis und wird auch so behandelt. Und gut zu wissen: Verbinden speichert den Token nicht einfach. Es ruft zuerst die GitHub-API auf — ein falscher Token scheitert genau hier im Panel, und nichts wird gespeichert. Unserer stimmt, also … GitHub verbinden.',
        fr: 'Le panneau ne demande qu’une chose : un personal access token — tu le crées dans les réglages développeur de GitHub. On clique dans le champ… et on colle le nôtre. Regarde : il reste masqué — cette clé est un secret, et elle est traitée comme tel. Et un détail qui compte : Connecter ne se contente pas de stocker le token. Il appelle d’abord l’API GitHub — un token faux échoue ici même, sur ce panneau, et rien n’est enregistré. Le nôtre est bon, alors… Connecter GitHub.',
      },
    },
    {
      // The verified result: Active in the panel, the badge on the card.
      id: 'active',
      leadInMs: 1000,
      tailMs: 1800,
      minMs: 18_000,
      narration: {
        en: 'Watch the status… Active. The call came back good, so the token is saved — once, for the whole workspace — and it never shows again, not even to you. We close the panel… and the GitHub card now wears the same Connected badge as Tavily.',
        de: 'Achte auf den Status … Aktiv. Der Aufruf kam gut zurück, also ist der Token gespeichert — einmal, für den ganzen Arbeitsbereich — und er taucht nie wieder auf, auch für dich nicht. Wir schließen das Panel … und die GitHub-Karte trägt jetzt dasselbe Badge Verbunden wie Tavily.',
        fr: 'Regarde le statut… Actif. L’appel est revenu bon, donc le token est enregistré — une fois, pour tout l’espace — et il ne s’affichera plus jamais, même pas pour toi. On ferme le panneau… et la carte GitHub porte maintenant le même badge Connectée que Tavily.',
      },
    },
    {
      // Task 3: the Connected tab, and the operations now live for agents.
      id: 'connected',
      leadInMs: 1200,
      tailMs: 1600,
      minMs: 25_000,
      narration: {
        en: 'Now the tab we started on: Connected. Two entries — Tavily, and GitHub, the one you just made. Let’s open GitHub once more. Same nineteen operations — but now they’re live: your agents can call them like built-in tools the moment a task needs them. That’s exactly how the Researcher does its web research, through Tavily.',
        de: 'Jetzt der Tab, auf dem wir gestartet sind: Verbunden. Zwei Einträge — Tavily, und GitHub, gerade von dir verbunden. Öffnen wir GitHub noch einmal. Dieselben neunzehn Operationen — aber jetzt sind sie live: Deine Agenten rufen sie auf wie eingebaute Tools, sobald eine Aufgabe sie braucht. Genau so macht der Rechercheur seine Web-Recherche, über Tavily.',
        fr: 'Maintenant, l’onglet du début : Connectées. Deux entrées — Tavily, et GitHub, celle que tu viens de faire. Rouvrons GitHub. Les mêmes dix-neuf opérations — mais désormais elles sont vivantes : tes agents les appellent comme des outils intégrés dès qu’une tâche en a besoin. C’est exactement ainsi que le Chercheur fait sa recherche web, via Tavily.',
      },
    },
    {
      // Task 4 opens: MCP for the tools nobody ships a connector for.
      id: 'mcp',
      chapterByLocale: {
        en: 'MCP servers',
        de: 'MCP-Server',
        fr: 'Serveurs MCP',
      },
      chapterTransition: 'cut',
      leadInMs: 2600,
      tailMs: 1600,
      minMs: 25_000,
      narration: {
        en: 'So far, ready-made connectors. But your company runs tools nobody ships a connector for — an internal wiki, a homegrown ticket system. For those there’s MCP, an open protocol: point Tale at your server, and its tools appear to your agents like built-in ones. One server is already registered here: the internal wiki.',
        de: 'So weit die fertigen Connectoren. Aber eure Firma nutzt Tools, für die niemand einen Connector baut — ein internes Wiki, ein selbst gebautes Ticketsystem. Dafür gibt es MCP, ein offenes Protokoll: Zeig Tale auf euren Server, und seine Tools erscheinen deinen Agenten wie eingebaute. Ein Server ist hier schon registriert: das interne Wiki.',
        fr: 'Jusqu’ici, des connecteurs prêts à l’emploi. Mais ton entreprise fait tourner des outils pour lesquels personne ne livre de connecteur — un wiki interne, un système de tickets maison. Pour eux, il y a MCP, un protocole ouvert : pointe Tale vers ton serveur, et ses outils apparaissent à tes agents comme des outils intégrés. Un serveur est déjà enregistré ici : le wiki interne.',
      },
    },
    {
      // The server panel, read honestly: address, no tools discovered yet.
      id: 'mcp-panel',
      leadInMs: 1000,
      tailMs: 1600,
      minMs: 24_000,
      narration: {
        en: 'Let’s open it. Here’s the address Tale will call… and the status: registered, but not connected — the wiki’s server isn’t reachable right now. The tools list says it plainly: none discovered, test the connection first. On a live server, Test connection pulls in the tool list, and from then on your agents can call those tools.',
        de: 'Öffnen wir ihn. Hier steht die Adresse, die Tale aufruft … und der Status: registriert, aber nicht verbunden — der Wiki-Server ist gerade nicht erreichbar. Die Tool-Liste sagt es ehrlich: keine erkannt, teste zuerst die Verbindung. Bei einem laufenden Server holt Verbindung testen die Tool-Liste herein, und ab dann können deine Agenten diese Tools aufrufen.',
        fr: 'Ouvrons-le. Voici l’adresse que Tale appellera… et le statut : enregistré, mais pas connecté — le serveur du wiki n’est pas joignable pour l’instant. La liste d’outils le dit sans détour : aucun découvert, teste d’abord la connexion. Sur un serveur en marche, Tester la connexion ramène la liste des outils, et dès lors tes agents peuvent les appeler.',
      },
    },
    {
      // The add dialog: name + URL typed for real, then deliberately
      // cancelled — saving would leave a row no cleanup type can sweep.
      id: 'add-server',
      leadInMs: 1000,
      tailMs: 1600,
      minMs: 26_000,
      narration: {
        en: 'Registering your own takes one form. Add MCP server… Two fields do the work: a name — support-tickets — and the URL where your server listens. Transport and authentication have sensible defaults. When your real server is live: save, test the connection, and its tools come in. Ours is imaginary — so we cancel, and nothing is saved.',
        de: 'Einen eigenen registrierst du mit einem Formular. MCP-Server hinzufügen … Zwei Felder tragen die Arbeit: ein Name — support-tickets — und die URL, unter der euer Server lauscht. Transport und Authentifizierung haben brauchbare Voreinstellungen. Wenn euer echter Server läuft: speichern, Verbindung testen, die Tools kommen herein. Unserer ist ausgedacht — also brechen wir ab, und nichts wird gespeichert.',
        fr: 'Enregistrer le tien tient dans un formulaire. Ajouter un serveur MCP… Deux champs font le travail : un nom — support-tickets — et l’URL où ton serveur écoute. Transport et authentification ont des réglages par défaut raisonnables. Quand ton vrai serveur tourne : enregistre, teste la connexion, ses outils arrivent. Le nôtre est imaginaire — alors on annule, et rien n’est enregistré.',
      },
    },
    {
      // Verify: the Connected tab holds the episode's artifact.
      id: 'verify',
      chapterByLocale: {
        en: 'The result',
        de: 'Das Ergebnis',
        fr: 'Le résultat',
      },
      chapterTransition: 'cut',
      leadInMs: 2400,
      tailMs: 1800,
      minMs: 21_000,
      narration: {
        en: 'Back to connectors, one last time. The Connected tab — and there’s the row we came for: GitHub, next to Tavily, available to every agent and automation in this workspace. Anyone on the team can open this page and see exactly what the workspace can reach.',
        de: 'Zurück zu den Connectoren, ein letztes Mal. Der Tab Verbunden — und da ist die Zeile, für die wir gekommen sind: GitHub, neben Tavily, verfügbar für jeden Agenten und jede Automatisierung im Arbeitsbereich. Jeder im Team kann diese Seite öffnen und sehen, was der Arbeitsbereich erreichen kann.',
        fr: 'Retour aux intégrations, une dernière fois. L’onglet Connectées — et voilà la ligne qu’on est venus chercher : GitHub, à côté de Tavily, disponible pour chaque agent et chaque automatisation de l’espace. N’importe qui dans l’équipe peut ouvrir cette page et voir ce que l’espace peut atteindre.',
      },
    },
    {
      id: 'recap',
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 22_000,
      narration: {
        en: 'And that’s the episode. You read a connector’s operations and hosts before trusting it, connected GitHub with a token that was checked on the spot, found it under Connected, staged an MCP server without saving a fake one, and read the package policy. The connectors section of the docs goes deeper on each.',
        de: 'Und das war die Episode. Du hast Operationen und Hosts eines Connectors gelesen, bevor du ihm vertraust, GitHub mit einem sofort geprüften Token verbunden, es unter Verbunden wiedergefunden, einen MCP-Server angelegt, ohne einen ausgedachten zu speichern — und die Paketrichtlinie gelesen. Die Doku zu Connectoren vertieft jedes Thema.',
        fr: 'Et voilà l’épisode. Tu as lu les opérations et les hôtes d’un connecteur avant de lui faire confiance, connecté GitHub avec un token vérifié sur-le-champ, retrouvé la connexion sous Connectées, préparé un serveur MCP sans enregistrer un serveur imaginaire, et lu la politique de paquets. La doc sur les intégrations approfondit chaque sujet.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'Next time: the people side — members, roles, and teams, and who sees what. See you in episode eight.',
        de: 'Nächstes Mal: die Menschen-Seite — Mitglieder, Rollen und Teams, und wer was sieht. Bis zur achten Episode.',
        fr: 'La prochaine fois : le côté humain — membres, rôles et équipes, et qui voit quoi. À bientôt pour l’épisode huit.',
      },
    },
  ],
} as const;
