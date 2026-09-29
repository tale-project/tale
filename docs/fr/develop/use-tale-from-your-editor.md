---
title: Utiliser Tale depuis ton éditeur ou un script
description: Interroge le chat REST depuis un script, connecte opencode ou Claude Code à l’endpoint MCP de Tale, ou confie la modification de tes scripts à un agent de projet qui utilise les modèles de ton organisation.
i18nLintExclude:
  - terminology-loanword
---

Tale s’intègre à ton travail de développement de trois façons. Elles diffèrent par l’endroit où tourne le modèle de langage et par la part du travail que Tale encadre :

| Tu veux | Voie | Modèle | Ce que Tale encadre |
| --- | --- | --- | --- |
| Interroger l’assistant de l’espace de travail depuis un script | [L’API REST de chat](#interroger-le-chat-rest-depuis-un-script) | Un modèle de l’organisation que tu nommes dans chaque requête | Tout le tour : accès aux modèles, budgets, consommation à ton nom |
| Les connaissances et les outils d’automatisation de Tale dans opencode ou Claude Code | [L’endpoint MCP](#connecter-opencode-ou-claude-code) | Le modèle configuré dans ton éditeur | Seulement les appels d’outils ; les appels au modèle de l’éditeur échappent à Tale |
| Faire modifier un script avec les modèles de ton organisation | [Un agent de projet sur une tâche](#confier-tes-scripts-a-un-agent-de-projet) | Le modèle de l’organisation configuré sur l’agent | Toute l’exécution : sandbox, budgets, consommation, revue |

Tale ne propose pas de point d’accès de modèle compatible OpenAI ; un éditeur ne peut donc pas utiliser Tale comme fournisseur de modèle. [La dernière section](#ce-qui-remplace-le-point-dacces-compatible-openai) explique ce qu’est devenu `/api/v1/chat/completions`.

## Créer une clé API

Tout accès depuis l’extérieur de l’application commence par une clé API personnelle. Les propriétaires, admins et développeurs la créent dans **Paramètres > API > REST** avec **Créer une clé API**, en choisissant un nom et une expiration. La valeur secrète ne s’affiche qu’une fois : copie-la dans ton gestionnaire de secrets ou un environnement de shell privé avant de fermer la boîte de dialogue. [Clés API](/fr/platform/admin/api-keys) décrit la création, le renouvellement et la révocation.

Une clé agit en ton nom. Elle porte ton rôle et tes accès aux projets actuels, et la consommation qu’elle entraîne t’est attribuée. Les tours de chat et les exécutions d’automatisation que tu lances avec la clé enregistrent aussi la clé, si bien que les limites de clé API s’y appliquent également ; une exécution d’agent de projet n’est attribuée qu’à toi. Un admin peut plafonner tes dépenses avec un budget personnel, d’équipe ou de rôle dans [Politiques et limites](/fr/platform/admin/governance/policies-and-limits) ; une requête qui dépasse un plafond est refusée avec `429 BUDGET_EXCEEDED`.

Les exemples de cette page lisent trois variables d’environnement. `TALE_URL` est l’origine de ton instance, sans `/api/v1`. `TALE_ORG_SLUG` est le slug de l’organisation, affiché dans **Paramètres > API > MCP** et renvoyé par `GET /api/v1/me`. Exporte les trois dans ton shell, et ne mets `TALE_API_KEY` dans aucun fichier que tu versionnes.

## Interroger le chat REST depuis un script

L’API REST de chat donne à un script le même assistant que celui du chat de l’application. Ce n’est pas un appel direct au modèle : chaque tour passe par l’assistant intégré de l’espace de travail, qui cherche dans les connaissances de ton organisation quand la question le demande et renvoie vers les tâches toute demande de document ou d’autre livrable. L’API est asynchrone. Un envoi répond `202` avec l’identifiant de la réponse, puis tu interroges l’état jusqu’à la fin du tour.

Les exemples partagent une fonction qui envoie la clé et l’en-tête d’organisation à chaque requête. Enregistre-la sous `tale-api.sh` :

```bash
# tale-api.sh : à charger avec source depuis ton shell ou depuis un script
: "${TALE_URL:?Définis TALE_URL sur l’origine de Tale, sans /api/v1}"
: "${TALE_API_KEY:?Définis TALE_API_KEY}"
: "${TALE_ORG_SLUG:?Définis TALE_ORG_SLUG}"
tale_api() {
  curl --fail-with-body -sS \
    -H "Authorization: Bearer $TALE_API_KEY" \
    -H "X-Organization-Slug: $TALE_ORG_SLUG" \
    -H 'Content-Type: application/json' "$@"
}
```

Charge-la dans ton shell, vérifie la clé et liste les modèles que tu peux appeler. Les exemples ont besoin de curl et de `jq`.

```bash
source ./tale-api.sh

# Au nom de qui la clé agit, et dans quelle organisation
tale_api "$TALE_URL/api/v1/me" | jq '{email: .user.email, organization: .organization.slug, role: .organization.role}'

# Les modèles que tu peux nommer : id et providerSlug
tale_api "$TALE_URL/api/v1/models" | jq -r '.models[] | "\(.id)\t\(.providerSlug)"'
```

Exporte `MODEL_ID` et `PROVIDER` d’après une ligne de cette liste. La conversation est un script, `ask-tale.sh`, enregistré à côté de la fonction et lancé avec `bash ask-tale.sh`. Il crée un fil personnel, pose une question, attend la fin du tour et affiche le texte de la réponse. `set -euo pipefail` l’arrête à la première requête en échec, si bien qu’il ne continue jamais avec un identifiant vide.

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/tale-api.sh"
: "${MODEL_ID:?Définis MODEL_ID sur un id de /models}"
: "${PROVIDER:?Définis PROVIDER sur le providerSlug indiqué avec lui}"

THREAD_ID=$(tale_api -X POST "$TALE_URL/api/v1/threads" -d '{"title":"Aide pour un script"}' | jq -er '.id')

BODY=$(jq -n --arg model "$MODEL_ID" --arg provider "$PROVIDER" \
  '{content: "Que dit notre runbook sur la rotation des mots de passe de base de données ?", model: $model, providerSlug: $provider}')
MESSAGE_ID=$(tale_api -X POST "$TALE_URL/api/v1/threads/$THREAD_ID/messages" -d "$BODY" | jq -er '.messageId')

# Interroger toutes les trois secondes, jusqu’à dix minutes, jusqu’à la fin du tour
STATUS=queued
for _ in $(seq 200); do
  STATUS=$(tale_api "$TALE_URL/api/v1/threads/$THREAD_ID/generation" | jq -r '.status')
  [ "$STATUS" = idle ] && break
  sleep 3
done
if [ "$STATUS" != idle ]; then
  echo "Aucune réponse en dix minutes ; arrêt du tour." >&2
  tale_api -X DELETE "$TALE_URL/api/v1/threads/$THREAD_ID/generation" > /dev/null
  exit 1
fi

# Lire la réponse annoncée par l’envoi, puis vérifier comment elle s’est terminée
REPLY=$(tale_api "$TALE_URL/api/v1/threads/$THREAD_ID/messages/$MESSAGE_ID")
if [ "$(jq -r '.status' <<< "$REPLY")" != complete ]; then
  jq -r '"Turn \(.status): \(.errorCode // "") \(.error // "")"' <<< "$REPLY" >&2
  exit 1
fi
if [ "$(jq -r '.finishReason // ""' <<< "$REPLY")" = length ]; then
  echo "La réponse a atteint sa limite de sortie et peut être tronquée." >&2
fi
jq -r '[.parts[] | select(.type == "text") | .text] | join("")' <<< "$REPLY"
```

Tant que l’envoi attend un worker, `GET .../messages/$MESSAGE_ID` peut encore répondre `404 MESSAGE_NOT_FOUND` ; le script ne lit donc la réponse qu’une fois le fil au repos. Un tour qui n’est pas terminé au bout de dix minutes est arrêté avec `DELETE .../generation`. Envoie les questions suivantes au même `THREAD_ID` pour garder le contexte de la conversation. L’envoi n’accepte que du texte, et il est refusé avec `409 CHAT_TURN_IN_PROGRESS` tant que le tour précédent du fil tourne encore.

Quand un script a besoin des passages correspondants plutôt que d’une réponse, `POST /api/v1/knowledge/search` les renvoie sans passer par l’assistant ; voir [Rechercher dans les fichiers d’un projet](/fr/develop/api-reference#rechercher-dans-les-fichiers-dun-projet). [Appeler Tale depuis un script](/fr/tutorials/developer/call-tale-from-a-script) construit la même conversation en Python avec la gestion des erreurs, et [Envoyer un message, puis suivre le tour](/fr/develop/api-reference#envoyer-un-message-puis-suivre-le-tour) couvre les nouvelles tentatives, les limites de jetons et les échecs.

## Connecter opencode ou Claude Code

L’[endpoint MCP](/fr/develop/mcp-endpoint) de Tale, `/api/v1/mcp`, met les outils de Tale à la disposition d’un agent d’éditeur. Le plus utile pour travailler sur des scripts est `get_knowledge`, qui récupère des passages dans les documents et les pages web explorées de ton organisation. L’endpoint expose aussi les outils d’automatisation : valider, tester, enregistrer, déployer et exécuter des automatisations, puis lire leurs exécutions. L’enregistrement, le déploiement, la définition ou la suppression d’un déclencheur, l’annulation d’une exécution et les exécutions réelles exigent la capacité développeur. Il n’y a ni outil de chat ni outil de skills ; pour copier les skills de ton organisation dans un dossier local, lis-les avec `GET /api/v1/skills` comme l’explique [Enregistrer et synchroniser les bundles de skills](/fr/develop/api-reference#enregistrer-et-synchroniser-les-bundles-de-skills).

Sur cette voie, le modèle de langage est celui configuré dans ton éditeur, pas l’un de ceux de ton organisation. Tale authentifie les appels d’outils et leur applique tes droits, mais les prompts, ton code et chaque passage renvoyé par un outil de Tale partent chez le fournisseur de modèle de cet éditeur. Les budgets, le suivi de consommation et les règles d’accès aux modèles de Tale ne s’appliquent pas à ces appels. Vérifie avant de te connecter que ton organisation autorise l’envoi de ses connaissances à ce fournisseur.

L’endpoint s’authentifie avec la clé API dans un en-tête et ne propose pas de connexion OAuth. Désactive la détection OAuth d’un client lorsqu’il le permet.

### opencode

Ajoute un serveur distant dans ta configuration globale d’opencode, `~/.config/opencode/opencode.json`, ou dans un `opencode.json` du projet. Avec `{env:TALE_API_KEY}`, opencode lit la clé dans ton environnement, si bien que le fichier ne contient jamais le secret. Remplace l’hôte et le slug par les tiens.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tale": {
      "type": "remote",
      "url": "https://your-host.example.com/api/v1/mcp",
      "oauth": false,
      "timeout": 60000,
      "headers": {
        "Authorization": "Bearer {env:TALE_API_KEY}",
        "X-Organization-Slug": "your-org-slug"
      }
    }
  }
}
```

`timeout` relève le délai par défaut d’opencode pour les requêtes MCP, cinq secondes, qu’une recherche de connaissances sous charge ou un appel à `run_deployed`, qui attend jusqu’à 30 secondes, peut dépasser. Lance opencode depuis un shell où `TALE_API_KEY` est définie. `opencode mcp list` indique si le serveur est configuré ; opencode préfixe les outils du nom du serveur, comme dans `tale_get_knowledge`.

### Claude Code

Enregistre l’endpoint comme serveur HTTP. La commande ci-dessous stocke la clé développée dans ta configuration privée de Claude Code pour le projet en cours :

```bash
claude mcp add --transport http tale "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG"
```

Pour partager le serveur avec une équipe dans un `.mcp.json` versionné, fais référence à la clé par une variable d’environnement afin que chacun fournisse la sienne :

```json
{
  "mcpServers": {
    "tale": {
      "type": "http",
      "url": "https://your-host.example.com/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${TALE_API_KEY}",
        "X-Organization-Slug": "your-org-slug"
      }
    }
  }
}
```

`claude mcp list` indique si Claude Code joint le serveur.

## Confier tes scripts à un agent de projet

Quand le modèle doit être l’un de ceux de ton organisation, confie plutôt le script à un [agent de projet](/fr/platform/projects/project-agents). Tale exécute alors un environnement de code comme OpenCode dans une sandbox, avec le modèle configuré sur l’agent. L’exécution compte dans les budgets du membre qui l’a démarrée et lui est attribuée ; une exécution que tu lances en REST t’est imputée, pas à la clé API. Les fichiers modifiés reviennent comme résultats de la tâche, qui attend ensuite la revue d’une personne. [Choisir un environnement d’agent](/fr/platform/agents/harnesses) compare les environnements ; OpenCode passe uniquement par la passerelle de modèles de Tale et ne reçoit donc jamais de clé de fournisseur.

Pour créer l’agent, il te faut le droit de modifier le projet, donc au moins le rôle Éditeur ; toute personne qui peut ouvrir le projet peut ensuite créer la tâche et y démarrer l’agent. L’organisation doit disposer d’un modèle utilisable par l’environnement et de capacité de sandbox libre. Dans l’application, ouvre l’onglet **Agents** du projet, choisis **Nouvel agent**, sélectionne OpenCode comme harness et un modèle, puis crée une tâche avec le script en pièce jointe, affecte-la à l’agent et démarre-le.

La même boucle fonctionne en REST depuis un terminal, avec `tale-api.sh` de l’exemple de chat. Vérifie d’abord que ce déploiement exécute OpenCode pour les agents de projet :

```bash
tale_api "$TALE_URL/api/v1/models" | jq -r '.harnesses[] | "\(.harness)\t\(.label)"'
```

Enregistre ensuite le script ci-dessous sous `hand-to-agent.sh` à côté de la fonction et lance-le avec `bash hand-to-agent.sh`. Il réutilise l’agent Assistant scripts du projet ou le crée au premier lancement, car les noms d’agents sont uniques dans un projet, sans tenir compte de la casse. Il dépose ensuite le script comme tâche et met l’agent au travail avec un commentaire qui le mentionne.

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/tale-api.sh"
: "${PROJECT_ID:?Définis PROJECT_ID sur un projet que tu peux modifier}"
: "${MODEL_ID:?Définis MODEL_ID sur un modèle utilisable par l’environnement}"
: "${PROVIDER:?Définis PROVIDER sur le providerSlug indiqué avec lui}"
AGENT_NAME="Assistant scripts"

AGENT_ID=$(tale_api "$TALE_URL/api/v1/projects/$PROJECT_ID/agents" \
  | jq -r --arg name "$AGENT_NAME" 'first(.agents[] | select((.name | ascii_downcase) == ($name | ascii_downcase)) | .id) // ""')
if [ -z "$AGENT_ID" ]; then
  AGENT_ID=$(tale_api -X POST "$TALE_URL/api/v1/projects/$PROJECT_ID/agents" \
    -d "$(jq -n --arg name "$AGENT_NAME" --arg model "$MODEL_ID" --arg provider "$PROVIDER" '{name: $name, harness: "opencode", model: $model, modelProvider: $provider, skills: [], connectors: [], instructions: "Modifie le script de la description de la tâche. Renvoie le script modifié sous forme de fichier et liste chaque modification dans ton compte rendu."}')" \
    | jq -er '.agent.id')
fi

TASK_ID=$(tale_api -X POST "$TALE_URL/api/v1/projects/$PROJECT_ID/tasks" \
  -d "$(jq -n --rawfile script backup.ps1 '{externalSystem: "terminal", externalId: "backup-ps1-hardening", title: "Fiabiliser backup.ps1", description: ("Ajoute la gestion des erreurs et une option de simulation à ce script PowerShell :\n\n" + $script)}')" \
  | jq -er '.task.id')

tale_api -X POST "$TALE_URL/api/v1/projects/$PROJECT_ID/tasks/$TASK_ID/comments" \
  -d "$(jq -n --arg agent "$AGENT_ID" '{body: ("@" + $agent + " prends cette tâche, s’il te plaît.")}')" > /dev/null
echo "TASK_ID=$TASK_ID"
```

`externalSystem` et `externalId` rendent la tâche idempotente : un nouvel envoi de la même paire renvoie la tâche existante. Une description contient jusqu’à 20 000 caractères ; pour un script plus long, charge-le dans le projet comme l’explique [Charger un fichier en deux étapes](/fr/develop/api-reference#charger-un-fichier-en-deux-etapes). Un agent répond à son identifiant et à son nom en minuscules, les espaces remplacés par des points ou supprimés ; `@assistant.scripts` fonctionne donc aussi.

La mention affecte la tâche à l’agent et démarre une exécution ; la tâche passe à `in_progress`. Une mention qui ne peut pas démarrer d’exécution reste un simple commentaire, sans message d’erreur, par exemple quand tu ne peux pas modifier la tâche, que l’automatisation des tâches est désactivée ou qu’une autre exécution occupe déjà la tâche. Définis `TASK_ID` sur la valeur affichée par le script, vérifie la tâche, puis lis le compte rendu de l’agent une fois la tâche arrivée à `in_review` :

```bash
tale_api "$TALE_URL/api/v1/projects/$PROJECT_ID/tasks/$TASK_ID" | jq -r '.task.status'
tale_api "$TALE_URL/api/v1/projects/$PROJECT_ID/tasks/$TASK_ID/comments?limit=20" \
  | jq -r '.comments[] | select(.authorType == "agent") | .body'
```

Examine les fichiers modifiés dans les résultats de la tâche, dans l’application, avant de valider la tâche. Pour renvoyer l’agent au travail avec des corrections, publie un nouveau commentaire qui le mentionne.

## Ce qui remplace le point d’accès compatible OpenAI

De la 0.2.10 à la 0.3, Tale proposait une couche compatible OpenAI : `POST /api/v1/chat/completions`, `POST /api/v1/images/generations` et un `GET /api/v1/models` au format OpenAI. Tale 0.4 a reconstruit la plateforme sans elle. Sur une version actuelle, un SDK OpenAI pointé sur `/api/v1` reçoit `404 NOT_FOUND` pour les chat completions, ou `400 ORG_SLUG_REQUIRED` quand ta clé appartient à plusieurs organisations, car le SDK n’envoie pas de `X-Organization-Slug` par défaut. `GET /api/v1/models` renvoie désormais la liste propre à Tale, avec les modèles et les environnements d’agents, pas le format OpenAI.

Utilise l’API REST de chat pour les questions posées par script, l’endpoint MCP pour les connaissances de Tale dans ton éditeur, et un agent de projet quand le travail doit tourner sur les modèles de ton organisation. [Mettre à niveau et rétablir un déploiement](/fr/self-hosted/operate/upgrades#03-04-lapi-compatible-openai-a-ete-retiree) signale ce retrait aux opérateurs qui quittent la 0.3.
