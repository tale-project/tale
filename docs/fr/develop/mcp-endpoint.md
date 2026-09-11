---
title: Endpoint MCP
description: Connecte un client MCP à Tale — un endpoint, 22 outils couvrant l'écriture d'automatisations, la gestion des exécutions et des déclencheurs, et la surface de capacités de l'organisation.
i18nLintExclude:
  - terminology-loanword
---

Tale est lui-même un serveur MCP. Pointe n'importe quel client MCP — un harnais d'agent, un IDE, ta propre boucle SDK — vers un endpoint, et il peut écrire et opérer des automatisations, chercher ce que l'organisation sait faire, invoquer une capacité et récupérer des connaissances, avec la même clé API que la surface REST. Là où REST est la couture de connector pour ton code, l'endpoint MCP est la couture pour les *modèles* : chaque outil répond du texte qu'un modèle peut lire et exploiter.

Lis ceci pour connecter un client et comprendre l'inventaire des outils. La grammaire d'écriture des automatisations n'est volontairement pas dupliquée ici — l'endpoint l'enseigne lui-même, via `get_docs`.

## Connecter un client

L'endpoint parle le protocole MCP `2025-06-18` (ou `2025-03-26` si le client le propose) en JSON-RPC sur HTTPS — réponses JSON pures, pas de flux SSE. Envoie un message par requête ou un batch JSON-RPC de 20 messages au plus : il est répondu sous forme de tableau, un batch composé uniquement de notifications répond 202, et chaque appel d'outil du batch après le premier puise dans le même budget de requêtes qu'une requête à part entière. Authentifie-toi avec une clé API d'organisation ([Clés API](/fr/platform/admin/api-keys) décrit la création). Si le détenteur de la clé appartient à plusieurs organisations, chaque requête doit aussi nommer celle qu’elle vise — l’en-tête `X-Organization-Slug`, vérifié contre les adhésions. Sans lui, une telle requête répond **400** `ORG_SLUG_REQUIRED` plutôt que de deviner depuis le dashboard ; une clé à organisation unique peut s’en passer.

```json
// POST https://your-host.example.com/api/v1/mcp
// Authorization: Bearer tale_...
// X-Organization-Slug: acme
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": { "name": "my-client", "version": "1.0.0" }
  }
}
```

Le serveur s'identifie comme `tale-platform`. Dans un client à bloc de config, ces deux en-têtes suffisent :

```json
{
  "mcpServers": {
    "tale": {
      "url": "https://your-host.example.com/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer tale_...",
        "X-Organization-Slug": "acme"
      }
    }
  }
}
```

`tools/list` renvoie l'inventaire complet ; tout verbe autre que `POST` répond **405** avec un en-tête `Allow: POST` — il n'y a pas de flux d'événements à écouter ni de session à supprimer. L’URL de l’endpoint de ton déploiement, le slug de l’organisation, le même inventaire en trois groupes et une requête `tools/list` à copier avec les deux en-têtes déjà en place se trouvent sous **Paramètres > API > MCP**.

## Les outils

Vingt-deux outils, en trois groupes, chacun avec un vrai schéma JSON auquel l'endpoint tient chaque appel — des arguments qui ne correspondent pas répondent l'erreur JSON-RPC `-32602` avec le nom du champ, jamais un résultat vide en silence. Les quatre outils qui prennent un document d'automatisation entier — validate, run, test, save — déclarent leur enveloppe d'appel (`automation`, plus `input`, `mode` ou `message` là où ils s'appliquent) et laissent le document lui-même ouvert : sa grammaire est ce que `get_docs` enseigne, et le moteur le valide dans la bande.

### Écriture

| Outil                 | Ce qu'il fait                                                        |
| --------------------- | -------------------------------------------------------------------- |
| `get_docs`            | La référence d'écriture des automatisations — grammaire, sortes de nœuds, nœuds de capacité et table des méthodes dans le dialecte `tools/call` de cet endpoint — en texte. |
| `get_catalog`         | Chaque type de nœud que ce déploiement sait exécuter ; `kind` restreint à une sorte de nœud et `compact: true` omet les schémas d'entrée. |
| `search_catalog`      | Chercher dans le catalogue de types de nœuds par mot-clé.            |
| `validate_automation` | Valider un document d'automatisation sans l'enregistrer.             |
| `run_automation`      | Exécuter un document d'automatisation directement contre les mocks déterministes. |
| `test_automation`     | Lancer les tests d'acceptation propres à une automatisation.         |
| `save_automation`     | Enregistrer un document comme nouvelle version immuable.             |
| `get_automation`      | Lire une version enregistrée (la dernière sans précision).           |
| `list_automations`    | Les automatisations de l'organisation avec leur dernière version, leur version déployée et les projets où chacune est installée (`projectIds`). |
| `deploy_automation`   | Promouvoir une version enregistrée comme version live.               |

### Gestion des exécutions & déclencheurs

| Outil            | Ce qu'il fait                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `run_deployed`   | Exécuter la version déployée en live et ATTENDRE le résultat fini — sortie, trace et effets en une réponse ; une exécution qui dure plus longtemps répond avec son `runId` à suivre. |
| `start_run`      | Démarrer la version déployée en arrière-plan et rendre aussitôt une poignée d'exécution ; suivre avec get_run. |
| `list_runs`      | Les exécutions récentes que la clé peut lire, la plus récente d'abord — d'une automatisation ou à travers les projets de l'organisation ; chacune nomme son `projectId`. |
| `get_run`        | Une exécution en entier : statut, sortie, trace, effets et `projectId` — l'id d'une exécution de projet est celui que prend `GET /api/v1/projects/{id}/runs/{runId}`. |
| `cancel_run`     | Arrêter une exécution à sa prochaine frontière de nœud.                                                        |
| `list_versions`  | L'historique de versions immuable d'une automatisation.                                                        |
| `list_triggers`  | Ce qui démarre les automatisations (jamais le secret du webhook).                                              |
| `delete_trigger` | Délier le déclencheur d'une automatisation ; ses versions et son historique restent.                           |
| `set_trigger`    | Lier ce qui démarre l'automatisation (planning/webhook/événement).                                             |

Prends `run_deployed` quand l'automatisation est rapide et que tu veux un seul appel avec la réponse dedans — il attend l'exécution jusqu'à 30 secondes, puis te rend la `runId` plutôt qu'un résultat à moitié fini. Prends `start_run` quand l'exécution peut durer des minutes — elle rend un `runId` aussitôt, et `get_run` le suit. Les deux tournent en live sur le même runner durable : ils autorisent, exécutent et enregistrent l'exécution de la même façon. `run_automation` est l'outil de la boucle de rédaction : il exécute un document non enregistré contre les mocks déterministes, et `mode: "live"` répond un refus qui te renvoie vers `run_deployed` — un document non enregistré n'a pas de voie live.

`start_run` prend aussi un `projectId` optionnel — le projet dans lequel l’exécution opère, pour que ses outils de tâches et de documents y agissent. Omets-le pour une exécution à l’échelle de l’organisation ou, quand l’automatisation est liée à un seul projet, pour celui-là. Une automatisation liée n’accepte qu’un projet auquel elle est liée. La poignée renvoyée nomme le `projectId` que l’exécution a reçu, et `list_automations` montre les `projectIds` de chaque automatisation — un client n’a donc jamais à deviner quelle URL de projet relit l’exécution côté REST.

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

Un appel refusé n'est pas une erreur de protocole : l'outil répond un refus lisible — `{"error": "...", "code": "...", "hint": "..."}`, où `code` est la valeur stable sur laquelle brancher (`AUTOMATION_NOT_FOUND`, …) et `hint` dit quoi faire — pour que le modèle appelant s'ajuste au lieu de planter, et le résultat porte `isError: true` pour qu'un client générique reconnaisse l'échec sans lire le texte. Cette convention vaut partout : problèmes de validation, déploiements manquants, refus de rôle et base de connaissances impossible à interroger reviennent comme des données avec le drapeau levé — exactement comme un appel qui a réellement levé. Une capacité qui répond `pending` — une mémoire enregistrée en attente de l'approbation d'un humain — est un résultat, pas un échec, et laisse `isError` à false ; une capacité `refused` (id inconnu, arguments rejetés par son schéma, aucun déploiement) est un échec et porte le drapeau.

## Où ça se place

L'endpoint MCP et l'[API REST](/fr/develop/api-reference) sont une seule surface en deux dialectes — même clé, même périmètre d'organisation, mêmes objets d'exécution (`start_run` ici et `POST .../runs` là-bas produisent la même exécution durable). Tale ne se connecte à aucun serveur MCP tiers dans cette version — l’endpoint est sa seule surface MCP, et la direction est toujours vers l’intérieur : ton client pilote Tale.
