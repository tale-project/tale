---
title: Utiliser Tale depuis ton éditeur ou un script
description: Appelle les modèles de ton organisation depuis opencode, Claude Code ou les SDK OpenAI et Anthropic, interroge le chat REST ou ajoute les outils MCP de Tale.
i18nLintExclude:
  - terminology-loanword
---

Tale s’intègre à ton travail de développement de quatre façons. Elles diffèrent par le modèle de langage qui répond et par la part du travail que Tale encadre :

| Tu veux | Voie | Modèle | Ce que Tale encadre |
| --- | --- | --- | --- |
| Les modèles de ton organisation comme fournisseur de modèles d’opencode, de Claude Code ou d’un script SDK | [Les endpoints de modèles](#model-endpoints) | Un modèle de l’organisation que tu nommes par son identifiant dans chaque requête | Chaque appel au modèle : accès aux modèles, garde-fous d’entrée, budgets, consommation à ton nom et à celui de ta clé ; pas les réponses |
| Interroger l’assistant de l’espace de travail depuis un script | [L’API REST de chat](#interroger-le-chat-rest-depuis-un-script) | Un modèle de l’organisation que tu nommes dans chaque requête | Tout le tour : accès aux modèles, budgets, consommation à ton nom |
| Les connaissances et les outils d’automatisation de Tale dans opencode ou Claude Code | [L’endpoint MCP](#connecter-opencode-ou-claude-code) | Le modèle configuré dans ton éditeur | Seulement les appels d’outils ; les appels au modèle de l’éditeur échappent à Tale |
| Faire modifier un script avec les modèles de ton organisation | [Un agent de projet sur une tâche](#confier-tes-scripts-a-un-agent-de-projet) | Le modèle de l’organisation configuré sur l’agent | Toute l’exécution : sandbox, budgets, consommation, revue |

Un éditeur peut en combiner deux avec la même clé : les endpoints de modèles comme fournisseur de modèles et l’endpoint MCP pour les connaissances de Tale. [La dernière section](#ce-qui-remplace-le-point-dacces-compatible-openai) explique en quoi les endpoints de modèles diffèrent de la couche compatible OpenAI de Tale 0.3.

## Créer une clé API

Tout accès depuis l’extérieur de l’application commence par une clé API personnelle. Les propriétaires, admins et développeurs la créent dans **Paramètres > API > REST** avec **Créer une clé API**, en choisissant un nom et une expiration ; un membre à qui un admin a attribué **Appeler les modèles par l'API** le peut aussi. La valeur secrète ne s’affiche qu’une fois : copie-la dans ton gestionnaire de secrets ou un environnement de shell privé avant de fermer la boîte de dialogue. [Clés API](/fr/platform/admin/api-keys) décrit la création, le renouvellement et la révocation.

Une clé agit en ton nom. Elle porte ton rôle et tes accès aux projets actuels, et la consommation qu’elle entraîne t’est attribuée. Les tours de chat, les appels aux modèles et les exécutions d’automatisation que tu lances avec la clé enregistrent aussi la clé, si bien que les limites de clé API s’y appliquent également ; une exécution d’agent de projet n’est attribuée qu’à toi. Un admin peut plafonner tes dépenses avec un budget personnel, d’équipe ou de rôle dans [Politiques et limites](/fr/platform/admin/governance/policies-and-limits) ; une requête qui dépasse un plafond est refusée avec `429 BUDGET_EXCEEDED`.

Les exemples de cette page lisent trois variables d’environnement. `TALE_URL` est l’origine de ton instance, sans `/api/v1`. `TALE_ORG_SLUG` est le slug de l’organisation, affiché dans **Paramètres > API > MCP**, dans **Paramètres > API > Modèles** une fois les endpoints de modèles activés, et renvoyé par `GET /api/v1/me`. Exporte les trois dans ton shell, et ne mets `TALE_API_KEY` dans aucun fichier que tu versionnes.

## Utiliser les modèles de ton organisation depuis tes outils {#model-endpoints}

Les endpoints de modèles permettent à opencode, à Claude Code et aux scripts écrits avec les SDK OpenAI ou Anthropic d’utiliser les modèles approuvés par ton organisation comme fournisseur de modèles. Tale parle les interfaces OpenAI Chat Completions et Anthropic Messages que ces outils utilisent déjà : tu changes une URL de base, une clé et un nom de modèle, pas ton code. Chaque requête est un simple appel au modèle : ni l’assistant de l’espace de travail, ni un fil, ni un outil de Tale n’interviennent, et la réponse revient telle que le modèle l’a envoyée.

### Avant de commencer

Les endpoints restent désactivés tant qu’un admin n’a pas activé **Endpoints de modèles pour les clés API** dans **Paramètres > Gouvernance > Modèles** ; [Modèles](/fr/platform/admin/governance/content-models#model-endpoints) décrit ce réglage. Les propriétaires, admins et développeurs peuvent ensuite les appeler grâce à leur rôle ; tout autre membre a besoin de la compétence **Appeler les modèles par l'API**, qu’un admin attribue dans [Compétences](/fr/platform/admin/governance/competences). `GET /api/v1/me` répond `capabilities.modelApi: true` dès que ta clé peut les appeler.

**Paramètres > API > Modèles** rassemble ce dont tes outils ont besoin : les deux URL de base, le slug de l’organisation, les modèles que tu peux appeler avec un bouton de copie pour chaque identifiant, et des configurations à copier pour opencode, Claude Code et le SDK OpenAI pour Python. Tant que ton organisation n’a pas activé les endpoints, l’onglet affiche **Les endpoints de modèles ne sont pas activés pour ton organisation**, et les propriétaires et les admins y trouvent **Ouvrir l'accès aux modèles**.

### Paramètres de connexion

| Réglage | Valeur |
| --- | --- |
| URL de base compatible OpenAI | `https://<host>/api/v1/openai` ; les SDK OpenAI et opencode ajoutent `/chat/completions` |
| URL de base compatible Anthropic | `https://<host>/api/v1/anthropic` ; les SDK Anthropic et Claude Code ajoutent `/v1/messages` |
| Clé | Ta clé API personnelle, en `Authorization: Bearer <key>`. Tale refuse l’en-tête `x-api-key` avec `401` : un client Anthropic doit donc envoyer la clé comme jeton d’authentification |
| Organisation | `X-Organization-Slug: <slug>`, obligatoire quand tu appartiens à plusieurs organisations |
| Modèle | `<providerSlug>/<modelId>` : le slug du fournisseur, une barre oblique et l’identifiant du modèle dans le catalogue de ce fournisseur, par exemple `openrouter/anthropic/claude-sonnet-4.6` ou `deepseek/deepseek-v4-flash` |

Le même identifiant vaut pour les deux endpoints. Vérifie la clé et liste les identifiants que tu peux appeler, avec ton hôte et ton slug à la place de `tale.example.com` et `acme` :

```bash
curl https://tale.example.com/api/v1/openai/models \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: acme"
```

La réponse est une liste de modèles au format OpenAI : `owned_by` est le slug du fournisseur, et `created` vaut toujours `0`. Elle ressemble à ceci, avec les identifiants que ton organisation te propose :

```json
{
  "object": "list",
  "data": [
    { "id": "openrouter/anthropic/claude-sonnet-4.6", "object": "model", "created": 0, "owned_by": "openrouter" },
    { "id": "deepseek/deepseek-v4-flash", "object": "model", "created": 0, "owned_by": "deepseek" }
  ]
}
```

La liste contient les modèles de chat de ton organisation que servent des identifiants de fournisseur de type **Clé API** ou **Variable d'environnement**, restreints par les modèles autorisés de chaque identifiant et par ton accès aux modèles. Les modèles servis par des identifiants d’abonnement n’y figurent pas, pas plus que ceux d’un fournisseur dont l’adresse est définie pour chaque identifiant, comme Azure. `GET /api/v1/models` donne pour chacun de ces modèles sa fenêtre de contexte, ses capacités et ses prix, sous les mêmes `providerSlug` et `id`.

### Brancher opencode sur Tale

Ajoute Tale comme fournisseur dans ton `opencode.json` global ou dans celui du projet. opencode le joint par son paquet compatible OpenAI et lit la clé dans `TALE_API_KEY`. Liste sous `models` chaque modèle que tu veux pouvoir choisir, sous son identifiant ; `model` définit le modèle par défaut, sous la forme `tale/` suivi de cet identifiant.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "tale": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Tale",
      "options": {
        "baseURL": "https://tale.example.com/api/v1/openai",
        "apiKey": "{env:TALE_API_KEY}",
        "headers": { "X-Organization-Slug": "acme" }
      },
      "models": {
        "openrouter/anthropic/claude-sonnet-4.6": { "name": "Claude Sonnet 4.6" }
      }
    }
  },
  "model": "tale/openrouter/anthropic/claude-sonnet-4.6"
}
```

Le bloc `provider` peut côtoyer le bloc `mcp` de la [configuration MCP](#opencode) dans le même fichier. Lance opencode depuis un shell où `TALE_API_KEY` est définie.

### Brancher Claude Code sur Tale

Claude Code lit son fournisseur de modèles dans des variables d’environnement. Définis-les dans le shell depuis lequel tu le lances :

```bash
export ANTHROPIC_BASE_URL="https://tale.example.com/api/v1/anthropic"
export ANTHROPIC_AUTH_TOKEN="$TALE_API_KEY"
export ANTHROPIC_CUSTOM_HEADERS="X-Organization-Slug: acme"
export ANTHROPIC_MODEL="openrouter/anthropic/claude-sonnet-4.6"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="openrouter/anthropic/claude-haiku-4.5"
unset ANTHROPIC_API_KEY
claude
```

`ANTHROPIC_AUTH_TOKEN` envoie la clé comme jeton Bearer. Laisse `ANTHROPIC_API_KEY` non définie : Claude Code l’enverrait en `x-api-key`, un en-tête que Tale refuse. `ANTHROPIC_DEFAULT_HAIKU_MODEL` est le modèle que Claude Code utilise pour ses tâches de fond ; les deux variables de modèle doivent nommer des identifiants de ta liste. L’outil WebSearch de Claude Code fait exécuter la recherche par le fournisseur du modèle lui-même : Tale refuse donc ces requêtes. Les outils que Claude Code exécute sur ta machine fonctionnent normalement.

### Appeler les modèles depuis un script

Le SDK OpenAI pour Python a besoin d’une autre URL de base et de l’en-tête d’organisation. Cet exemple lit la clé dans `TALE_API_KEY`, demande une réponse complète, puis en reçoit une seconde en flux :

```python
import os

from openai import OpenAI

client = OpenAI(
    base_url="https://tale.example.com/api/v1/openai",
    api_key=os.environ["TALE_API_KEY"],
    default_headers={"X-Organization-Slug": "acme"},
)
MODEL = "openrouter/anthropic/claude-sonnet-4.6"

reply = client.chat.completions.create(
    model=MODEL,
    messages=[{"role": "user", "content": "Que signifie l’expression cron 0 3 * * 1 ?"}],
)
print(reply.choices[0].message.content)

stream = client.chat.completions.create(
    model=MODEL,
    messages=[{"role": "user", "content": "Écris un message de commit pour la correction d’une coquille."}],
    stream=True,
)
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print()
```

Les outils, `tool_calls` et les images fonctionnent comme avec OpenAI, et le `model` de la réponse est l’identifiant que tu as envoyé. Un flux se termine par `data: [DONE]` ; son dernier fragment, qui porte la consommation, n’arrive que si tu passes `stream_options={"include_usage": True}`.

Le SDK Anthropic pour Python prend la clé comme jeton d’authentification. Exécute-le avec `ANTHROPIC_API_KEY` non définie, car le SDK enverrait la valeur de cette variable en `x-api-key`, un en-tête que Tale refuse :

```python
import os

import anthropic

client = anthropic.Anthropic(
    base_url="https://tale.example.com/api/v1/anthropic",
    auth_token=os.environ["TALE_API_KEY"],
    default_headers={"X-Organization-Slug": "acme"},
)

message = client.messages.create(
    model="openrouter/anthropic/claude-sonnet-4.6",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Explique l’erreur ECONNRESET en un paragraphe."}],
)
print(message.content[0].text)
```

### Ce que Tale vérifie à chaque appel

Chaque appel est encadré comme une requête de chat, pour la personne dont la clé l’a envoyé :

- **L’interrupteur et ton droit.** L’organisation a activé les endpoints, et ton rôle ou ta compétence t’autorise à les appeler.
- **Le modèle.** Il doit figurer dans ta liste, et l’accès aux modèles de l’organisation doit te l’autoriser au moment de l’appel. Les modèles autorisés des identifiants du fournisseur s’appliquent aussi.
- **Ce que le modèle sait lire.** Les images exigent un modèle capable de lire des images, et les outils un modèle qui les accepte. Les images passent en parties OpenAI `image_url` avec une URL `data:` ou `https:`, ou en blocs Anthropic `image` en base64 ou avec une URL `https:`, y compris dans les résultats d’outils. Les documents passent en parties OpenAI `file` ou en blocs Anthropic `document`.
- **Les garde-fous d’entrée.** La sécurité du contenu, la protection PII et le fournisseur de modération de l’organisation lisent chaque texte de la requête avant sa transmission : les instructions système et développeur, tes tours et ceux de l’assistant, les appels d’outils, leurs résultats et les définitions d’outils, ainsi que les documents fournis en texte. Un blocage refuse la requête, un masquage envoie au modèle le texte masqué. Ne sont pas filtrés : les réponses du modèle, ainsi que les images et les documents qui ne sont pas du texte. Les détails se trouvent dans [Garde-fous](/fr/platform/admin/governance/guardrails#model-endpoints).
- **Les budgets.** Avant l’appel, Tale calcule le pire cas, l’estimation du prompt plus la sortie maximale possible, au prix catalogue du modèle. Si ce pire cas ne tient pas dans ce qui reste sous un plafond de budget qui s’applique à toi, à tes équipes, à l’organisation ou à la clé, Tale refuse l’appel avec `429 BUDGET_EXCEEDED` ; sinon, il le réserve sur ces plafonds tant que l’appel tourne. Un `max_tokens` plus bas passe plus facilement. Ensuite, Tale impute à ton nom et à la clé le coût mesuré par la passerelle de modèles et les tokens déclarés. Un appel que tu interromps est quand même imputé pour ce que le modèle a produit. Chaque appel compte pour une requête et apparaît comme **Appel API direct** dans l’analyse de l’usage.
- **Huit appels à la fois.** Toi et chacune de tes clés pouvez avoir huit appels en cours en même temps. Un neuvième est refusé avec `429 MODEL_API_CONCURRENCY_EXCEEDED` et un `Retry-After` de deux secondes.

Tes outils ne voient jamais de clé de fournisseur. Tale relaie chaque appel par sa passerelle de modèles, avec une clé créée pour cette seule requête et ce seul modèle. Révoquer ta clé API dans **Paramètres > API > REST** met fin à son accès dès la requête suivante ; une réponse déjà en cours de flux se termine.

### Ce que les endpoints ne servent pas

- **Les outils que le fournisseur du modèle exécute lui-même.** `web_search_options` d’OpenAI et tout outil dont le type n’est ni `function` ni `custom`, ainsi que la recherche web, la récupération web, l’exécution de code et les ensembles d’outils MCP d’Anthropic, avec les champs `mcp_servers` et `container`, sont refusés avec `400 MODEL_API_VENDOR_TOOL_UNSUPPORTED` : Tale ne pourrait ni les mesurer ni les auditer. Tes propres outils sont relayés et reviennent en `tool_calls` ou `tool_use`, y compris les outils client `bash`, `text_editor`, `computer` et `memory` d’Anthropic.
- **L’audio en entrée.** Les requêtes avec des parties `input_audio` sont refusées.
- **Les requêtes que Tale ne peut ni facturer ni garder dans ton organisation.** Plus de huit réponses par requête (`n`), les fichiers stockés dans le compte du fournisseur (un `file_id` OpenAI, une source Anthropic de type `file`), un `service_tier` autre que `auto` ou `default` (`auto` ou `standard_only` chez Anthropic), la sortie audio et `store: true` sont refusés avec `400 INVALID_BODY`.
- **Les autres routes.** `count_tokens` et toutes les autres routes d’Anthropic ne sont pas servies, pas plus que les routes OpenAI au-delà des chat completions et de la liste des modèles, comme les embeddings, Responses ou la génération d’images.
- **L’assistant et les outils de Tale.** Pour eux, utilise [l’API REST de chat](#interroger-le-chat-rest-depuis-un-script) ou [l’endpoint MCP](#connecter-opencode-ou-claude-code).

### Diagnostiquer un appel refusé

Chaque refus arrive dans le format d’erreur de l’interface appelée, si bien que ton SDK le signale comme une erreur OpenAI ou Anthropic. Son champ `code` porte le code stable de Tale ; la [référence de l’API](/fr/develop/api-reference#model-endpoints) les liste tous.

| Statut et code | Que faire |
| --- | --- |
| `401 UNAUTHORIZED` | Envoie la clé en `Authorization: Bearer`, jamais en `x-api-key`. Pour Claude Code, définis `ANTHROPIC_AUTH_TOKEN` et retire `ANTHROPIC_API_KEY` ; pour les SDK Anthropic, passe la clé en `auth_token` ou `authToken`. Une clé révoquée ou expirée répond aussi `401`. |
| `400 ORG_SLUG_REQUIRED` | Tu appartiens à plusieurs organisations. Envoie `X-Organization-Slug`. |
| `403 MODEL_API_DISABLED` | L’organisation n’a pas activé les endpoints. Adresse-toi à un admin. |
| `403 MODEL_API_FORBIDDEN` | Ton rôle ne peut pas les appeler. Demande à un admin de t’attribuer **Appeler les modèles par l'API**. |
| `404 MODEL_API_MODEL_UNKNOWN` | L’identifiant ne figure pas dans ta liste. Copie-en un depuis `GET /api/v1/openai/models` ou l’onglet **Modèles**, slug du fournisseur compris. |
| `403 MODEL_API_MODEL_FORBIDDEN` | L’accès aux modèles bloque ce modèle pour toi. Choisis-en un autre ou adresse-toi à un admin. |
| `400 MODEL_API_VISION_UNSUPPORTED`, `400 MODEL_API_TOOLS_UNSUPPORTED` | Choisis un modèle qui lit les images ou accepte les outils, ou envoie la requête sans eux. |
| `400 MODEL_API_VENDOR_TOOL_UNSUPPORTED` | Retire l’outil que le fournisseur exécuterait lui-même, comme une recherche web. Dans Claude Code, c’est l’outil WebSearch qui provoque ce refus. |
| `400 MODEL_API_GUARDRAIL_BLOCKED` | Un garde-fou a refusé le prompt système ou un message, et rien n’a atteint le modèle. Reformule, ou interroge un admin sur la règle. |
| `403 MODEL_API_GUARDRAIL_UNSUPPORTED` | La protection PII de l’organisation tokenise, ce que les endpoints de modèles ne peuvent pas respecter. Un admin peut la passer en masquage ou en blocage. |
| `429 RATE_LIMITED` | Tu as envoyé plus de requêtes que le budget partagé de tes clés API ne le permet. Attends la durée de `Retry-After` ; voir [les limites de débit](/fr/develop/rate-limits). |
| `429 BUDGET_EXCEEDED` | Un plafond de budget est atteint. `Retry-After` indique le temps restant avant sa réinitialisation, et la réponse porte `x-should-retry: false` pour que les SDK ne réessaient pas d’eux-mêmes. Attends, ou demande à un admin de relever le plafond. |
| `503 MODEL_API_UNAVAILABLE`, `503 MODEL_API_GUARDRAIL_UNAVAILABLE` | Un service nécessaire à l’appel est indisponible, comme la passerelle de modèles ou le fournisseur de modération. Réessaie plus tard ; si le problème persiste, demande à un admin de vérifier les identifiants du fournisseur ou le fournisseur de modération. |
| `MODEL_API_UPSTREAM_ERROR` | Le fournisseur du modèle a refusé l’appel, et le message vient de lui. `400`, `413`, `422`, `429`, `503` et `529` gardent leur statut ; tout autre refus arrive en `502`. |

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

## Utiliser les outils de Tale dans opencode ou Claude Code {#connecter-opencode-ou-claude-code}

L’[endpoint MCP](/fr/develop/mcp-endpoint) de Tale, `/api/v1/mcp`, met les outils de Tale à la disposition d’un agent d’éditeur. Le plus utile pour travailler sur des scripts est `get_knowledge`, qui récupère des passages dans les documents et les pages web explorées de ton organisation. L’endpoint expose aussi les outils d’automatisation : valider, tester, enregistrer, déployer et exécuter des automatisations, puis lire leurs exécutions. L’enregistrement, le déploiement, la définition ou la suppression d’un déclencheur, l’annulation d’une exécution et les exécutions réelles exigent la capacité développeur. Il n’y a ni outil de chat ni outil de skills ; pour copier les skills de ton organisation dans un dossier local, lis-les avec `GET /api/v1/skills` comme l’explique [Enregistrer et synchroniser les bundles de skills](/fr/develop/api-reference#enregistrer-et-synchroniser-les-bundles-de-skills).

Sur cette voie, le modèle de langage est celui configuré dans ton éditeur. Tale authentifie les appels d’outils et leur applique tes droits, mais les prompts, ton code et chaque passage renvoyé par un outil de Tale partent chez le fournisseur de modèle de cet éditeur. Si ce fournisseur est un autre service, les budgets, le suivi de consommation et les règles d’accès aux modèles de Tale ne s’appliquent pas à ses appels ; vérifie avant de te connecter que ton organisation autorise l’envoi de ses connaissances à ce fournisseur. Si l’éditeur utilise [les endpoints de modèles](#model-endpoints) comme fournisseur, les passages ne vont qu’à des modèles approuvés par ton organisation, et chaque appel au modèle est encadré comme décrit plus haut.

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

Pour que la modification se fasse dans Tale, dans une sandbox et avec la revue d’une personne, confie le script à un [agent de projet](/fr/platform/projects/project-agents). Tale exécute alors un environnement de code comme OpenCode dans une sandbox, avec le modèle configuré sur l’agent. L’exécution compte dans les budgets du membre qui l’a démarrée et lui est attribuée ; une exécution que tu lances en REST t’est imputée, pas à la clé API. Les fichiers modifiés reviennent comme résultats de la tâche, qui attend ensuite la revue d’une personne. [Choisir un environnement d’agent](/fr/platform/agents/harnesses) compare les environnements ; OpenCode passe uniquement par la passerelle de modèles de Tale et ne reçoit donc jamais de clé de fournisseur.

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

## Ce qui a changé depuis Tale 0.3 {#ce-qui-remplace-le-point-dacces-compatible-openai}

De la 0.2.10 à la 0.3, Tale proposait une couche compatible OpenAI : `POST /api/v1/chat/completions`, `POST /api/v1/images/generations` et un `GET /api/v1/models` au format OpenAI, dont le champ `model` pouvait désigner un agent. Tale 0.4 a reconstruit la plateforme sans elle. Les [endpoints de modèles](#model-endpoints) prennent sa place pour les appels aux modèles, avec des différences qu’un client écrit pour la 0.3 doit suivre :

- L’URL de base est `/api/v1/openai`, ou `/api/v1/anthropic` pour un client Anthropic, et non `/api/v1`. Un SDK OpenAI pointé sur `/api/v1` reçoit toujours `404 NOT_FOUND` pour les chat completions, et `GET /api/v1/models` renvoie la liste propre à Tale, avec les modèles et les environnements d’agents, pas le format OpenAI.
- `model` désigne un modèle sous la forme `<providerSlug>/<modelId>`, jamais un agent. Pour l’assistant de l’espace de travail, utilise l’API REST de chat ; pour faire travailler un agent, un agent de projet.
- La génération d’images n’est pas servie.
- Les endpoints restent désactivés tant qu’un admin ne les a pas activés, et chaque appel passe par l’accès aux modèles, les garde-fous d’entrée et les budgets.

[Mettre à niveau et rétablir un déploiement](/fr/self-hosted/operate/upgrades#03-04-lapi-compatible-openai-a-ete-retiree) signale ce retrait aux opérateurs qui quittent la 0.3.
