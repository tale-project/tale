---
title: Monter un serveur MCP depuis zéro
description: Câble un serveur Model Context Protocol comme connector personnalisée pour que n'importe quel agent Tale de l'organisation appelle ses outils.
---

Un serveur Model Context Protocol (MCP) est un processus qui expose une liste d'outils via un petit protocole JSON-RPC. Tale enregistre un serveur MCP une fois au niveau de l'organisation ; à partir de là, chaque agent dont l'onglet Outils inclut ce serveur peut appeler ses outils. Ce parcours mène un serveur MCP tout neuf de « repo vide » à « appelé par un agent dans un chat » sur une instance Tale.

Il te faut le rôle Developer, un hôte qui peut exécuter le serveur MCP (ton portable suffit pour le parcours ; un service managé ou un conteneur pour la production) et une URL HTTPS que Tale peut joindre. Les organisations Cloud joignent les URLs publiques par défaut ; les instances auto-hébergées ont besoin d'un accès réseau vers l'endroit où tourne le serveur MCP.

## Avant de commencer

Confirme deux choses. Tu as Node 20 ou Python 3.11 installé — les SDK MCP officiels visent ces runtimes. L'instance Tale peut joindre l'URL de ton serveur MCP — pour le développement local, un tunnel `ngrok` ou équivalent fait l'affaire ; pour la production, héberge le serveur quelque part avec un endpoint HTTPS stable. Le côté conceptuel de MCP dans Tale vit dans [Outils d'agent](/fr/platform/agents/tools) ; ce parcours est le câblage.

## Étape 1 — Échafauder le serveur

Le premier geste est de générer le serveur MCP minimal — un outil, un handler. Le SDK officiel s'occupe de la plomberie du protocole pour que tu n'écrives que l'outil.

```bash
npm create mcp-server@latest hello-tale
cd hello-tale
```

Ouvre `src/index.ts` et remplace l'outil d'exemple par un qui renvoie l'heure courante dans un fuseau horaire donné :

```ts
server.tool(
  'current_time',
  'Return the current time in a given timezone',
  { timezone: z.string() },
  async ({ timezone }) => {
    const now = new Date().toLocaleString('en-US', { timeZone: timezone });
    return { content: [{ type: 'text', text: now }] };
  },
);
```

Lance le serveur localement :

```bash
npm run start
```

Le serveur écoute sur `http://localhost:3000/mcp` par défaut. L'échafaudage est en place ; rien dans Tale ne le connaît encore.

## Étape 2 — L'exposer en HTTPS

Les serveurs MCP que Tale peut appeler ont besoin d'une URL HTTPS avec un certificat valide. Pour le développement local, pointe un tunnel `ngrok` sur le port 3000 et copie l'URL publique qu'il affiche. Pour la production, héberge le serveur derrière ton ingress habituel — Caddy, Nginx, une fonction managée, tout ce qui termine le TLS.

Vérifie que l'URL publique répond à un health-check :

```bash
curl -sS "https://abcd.ngrok.app/mcp/health"
```

Un 200 confirme la joignabilité. Un 502 ou un timeout veut dire que le tunnel ne route pas ; relance-le ou vérifie le pare-feu.

## Étape 3 — Enregistrer le serveur dans Tale

Un serveur MCP joignable reste invisible pour Tale tant que tu ne l'as pas enregistré. Ouvre **Paramètres > Connectors > Serveurs MCP** et clique **Nouveau serveur**. Remplis :

- **Nom** — `Hello Tale time`
- **URL** — l'URL HTTPS publique de l'étape 2 (par ex. `https://abcd.ngrok.app/mcp`)
- **Auth** — bearer token si ton serveur en exige un, aucun pour le parcours

Clique **Enregistrer**. Tale appelle la méthode `list_tools` du serveur pour découvrir l'inventaire d'outils ; le panneau affiche `current_time` avec sa description. Le serveur est désormais enregistré pour toute l'organisation.

## Étape 4 — Attacher le serveur à un agent et appeler l'outil

Un serveur enregistré n'est joignable que par les agents qui s'y abonnent. Ouvre n'importe quel agent, clique **Outils > MCP**, active **Hello Tale time** et enregistre. Ouvre un chat avec l'agent et demande « what time is it in Tokyo right now ». Le chat rend une carte d'appel d'outil `current_time` ; la déplier montre `{ "timezone": "Asia/Tokyo" }` et l'horodatage que ton serveur a renvoyé, et la réponse de l'agent utilise l'horodatage.

## Où ça s'utilise

Un serveur MCP est la bonne forme quand un outil doit vivre hors de Tale — du code possédé par ton équipe, un service dans un autre réseau, une API tierce que tu enveloppes. Les outils personnalisés de [Construire un outil personnalisé](/fr/tutorials/developer/build-a-custom-tool) sont la bonne forme quand l'outil est ponctuel et vit dans les paramètres d'une seule organisation.

Pour la grande image de comment les outils élargissent ce qu'un agent peut faire, voir [Outils d'agent](/fr/platform/agents/tools). Pour câbler une connector qui enveloppe une API tierce plutôt que ton propre code, [Aperçu des connectors](/fr/platform/connectors/overview) est la lecture suivante.
