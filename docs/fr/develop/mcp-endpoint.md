---
title: Endpoint MCP
description: Connecte un client MCP à Tale — un endpoint, 22 outils couvrant l'écriture d'automatisations, la gestion des exécutions et des déclencheurs, et la surface de capacités de l'organisation.
i18nLintExclude:
  - terminology-loanword
---

Tale est lui-même un serveur MCP. Pointe n'importe quel client MCP — un harnais d'agent, un IDE, ta propre boucle SDK — vers un endpoint, et il peut écrire et opérer des automatisations, chercher ce que l'organisation sait faire, invoquer une capacité et récupérer des connaissances, avec la même clé API que la surface REST. Là où REST est la couture de connector pour ton code, l'endpoint MCP est la couture pour les *modèles* : chaque outil répond du texte qu'un modèle peut lire et exploiter.

Lis ceci pour connecter un client et comprendre l'inventaire des outils. La grammaire d'écriture des automatisations n'est volontairement pas dupliquée ici — l'endpoint l'enseigne lui-même, via `get_docs`.

## Connecter un client

L'endpoint parle le protocole MCP `2025-03-26` en JSON-RPC sur HTTPS — réponses JSON pures, pas de flux SSE, un message par requête (un batch répond l'erreur `-32600`). Authentifie-toi avec une clé API d'organisation ([Clés API](/fr/platform/admin/api-keys) décrit la création) :

```json
// POST https://your-host.example.com/api/v1/mcp
// Authorization: Bearer tale_...
{ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }
```

Le serveur s'identifie comme `tale-platform`. Dans un client à bloc de config, c'est tout ce qu'il faut :

```json
{
  "mcpServers": {
    "tale": {
      "url": "https://your-host.example.com/api/v1/mcp",
      "headers": { "Authorization": "Bearer tale_..." }
    }
  }
}
```

`tools/list` renvoie l'inventaire complet ; `GET` sur l'endpoint répond **405** — il n'y a pas de flux d'événements à écouter. L’URL de l’endpoint de ton déploiement, le même inventaire en trois groupes et une requête `tools/list` à copier se trouvent sous **Paramètres > API > MCP**.

## Les outils

Vingt-deux outils, en trois groupes. Les outils d'écriture prennent des documents d'automatisation entiers et valident tout eux-mêmes — leurs schémas restent ouverts sur le fil, et `get_docs` est la référence qu'un modèle lit d'abord. Les outils de gestion et de capacités prennent des arguments simples et déclarent de vrais schémas JSON.

### Écriture

| Outil                 | Ce qu'il fait                                                        |
| --------------------- | -------------------------------------------------------------------- |
| `get_docs`            | La grammaire des automatisations et le guide d'écriture, en texte.   |
| `get_catalog`         | Chaque type de nœud que ce déploiement sait exécuter.                |
| `search_catalog`      | Chercher dans le catalogue de types de nœuds par mot-clé.            |
| `validate_automation` | Valider un document d'automatisation sans l'enregistrer.             |
| `run_automation`      | Exécuter un document d'automatisation directement contre les mocks déterministes. |
| `test_automation`     | Lancer les tests d'acceptation propres à une automatisation.         |
| `save_automation`     | Enregistrer un document comme nouvelle version immuable.             |
| `get_automation`      | Lire une version enregistrée (la dernière sans précision).           |
| `list_automations`    | Les automatisations de l'organisation avec leurs dernières versions. |
| `deploy_automation`   | Promouvoir une version enregistrée comme version live.               |

### Gestion des exécutions & déclencheurs

| Outil            | Ce qu'il fait                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `run_deployed`   | Exécuter la version déployée en live et ATTENDRE le résultat fini — sortie, trace et effets en une réponse ; une exécution qui dure plus longtemps répond avec son `runId` à suivre. |
| `start_run`      | Démarrer la version déployée en arrière-plan et rendre aussitôt une poignée d'exécution ; suivre avec get_run. |
| `list_runs`      | Les exécutions récentes, la plus récente d'abord — d'une automatisation ou de toute l'organisation.            |
| `get_run`        | Une exécution en entier : statut, sortie, trace et effets.                                                     |
| `cancel_run`     | Arrêter une exécution à sa prochaine frontière de nœud.                                                        |
| `list_versions`  | L'historique de versions immuable d'une automatisation.                                                        |
| `list_triggers`  | Ce qui démarre les automatisations (jamais le secret du webhook).                                              |
| `delete_trigger` | Délier le déclencheur d'une automatisation ; ses versions et son historique restent.                           |
| `set_trigger`    | Lier ce qui démarre l'automatisation (planning/webhook/événement).                                             |

Prends `run_deployed` quand l'automatisation est rapide et que tu veux un seul appel avec la réponse dedans — il attend l'exécution jusqu'à 30 secondes, puis te rend la `runId` plutôt qu'un résultat à moitié fini. Prends `start_run` quand l'exécution peut durer des minutes — elle rend un `runId` aussitôt, et `get_run` le suit. Les deux tournent en live sur le même runner durable : ils autorisent, exécutent et enregistrent l'exécution de la même façon. `run_automation` est l'outil de la boucle de rédaction : il exécute un document non enregistré contre les mocks déterministes, et `mode: "live"` répond un refus qui te renvoie vers `run_deployed` — un document non enregistré n'a pas de voie live.

`start_run` prend aussi un `projectId` optionnel — le projet dans lequel l’exécution opère, pour que ses outils de tâches et de documents y agissent. Omets-le pour une exécution à l’échelle de l’organisation ou, quand l’automatisation est liée à un seul projet, pour celui-là. Une automatisation liée n’accepte qu’un projet auquel elle est liée.

### Capacités & connaissances

| Outil                 | Ce qu'il fait                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_capabilities` | Chercher tout ce que cette organisation sait faire — ses automatisations, actions de connector, skills et outils.                                  |
| `invoke_capability`   | Invoquer une capacité par id. Une action que l'organisation soumet à validation répond un résultat d'approbation en attente au lieu de s'exécuter. |
| `get_knowledge`       | Récupérer des passages des connaissances de l'organisation — ses documents et ses pages web crawlées.                                              |

Dans cette version, le registre tient les automatisations déployées de l’organisation — `invoke_capability` sur l’une d’elles est le même acte que `run_deployed`. Les outils builtin, les actions de connector, les skills et les serveurs MCP externes ne font pas partie de ce registre ; un id qui n’est pas une automatisation déployée reçoit un refus lisible, pas une erreur. Une capacité que l'organisation place derrière une approbation ne s'exécute pas en silence — `invoke_capability` répond un résultat d'approbation en attente que le modèle peut relayer.

## Ce que la clé peut faire

La clé prouve qui appelle ; le rôle de son détenteur décide ce que l'appel peut faire — exactement comme dans le produit :

- **Toute clé de membre** — chaque outil de lecture, `run_automation` (toujours contre les mocks), `search_capabilities`, `get_knowledge`.
- **Capacité développeur requise** — `save_automation`, `deploy_automation`, `set_trigger`, `delete_trigger`, `cancel_run`, et l'exécution live (`run_deployed`, `start_run`).

Un appel refusé n'est pas une erreur de protocole : l'outil répond un refus lisible — `{"error": "...", "hint": "..."}` — pour que le modèle appelant s'ajuste au lieu de planter. Cette convention vaut partout : problèmes de validation, déploiements manquants et refus de rôle reviennent comme des données ; `isError` est réservé à un appel qui a réellement levé.

## Où ça se place

L'endpoint MCP et l'[API REST](/fr/develop/api-reference) sont une seule surface en deux dialectes — même clé, même périmètre d'organisation, mêmes objets d'exécution (`start_run` ici et `POST .../runs` là-bas produisent la même exécution durable). Tale ne se connecte à aucun serveur MCP tiers dans cette version — l’endpoint est sa seule surface MCP, et la direction est toujours vers l’intérieur : ton client pilote Tale.
