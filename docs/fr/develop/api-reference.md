---
title: Référence API
description: Endpoints REST API pour les services RAG, Crawler et Platform.
---

Chaque service Tale a sa propre API REST. Elles sont utilisées en interne entre services mais aussi disponibles pour l’intégration directe avec des systèmes externes.

## Documentation API interactive

Tous les services Python ont une UI Swagger pour explorer et tester l’API :

| Service | URL Swagger UI             | OpenAPI JSON                       |
| ------- | -------------------------- | ---------------------------------- |
| RAG     | http://localhost:8001/docs | http://localhost:8001/openapi.json |
| Crawler | http://localhost:8002/docs | http://localhost:8002/openapi.json |

## API RAG

L’API RAG gère l’indexation et la recherche des documents. C’est le moteur derrière la base de connaissances.

### Téléverser un document

```http
POST /api/v1/documents/upload
Content-Type: multipart/form-data
```

```text
file:      <fichier binaire>
file_id:   "unique-file-id"
sync:      "true"  (optionnel, attendre la fin de l'indexation)
metadata:  '{"source": "upload"}'  (JSON optionnel)
```

L’indexation tourne en arrière-plan par défaut. `sync=true` attend la fin avant de répondre.

### Vérifier les statuts de documents

```http
POST /api/v1/documents/statuses
```

```json
{
  "file_ids": ["file-id-1", "file-id-2"]
}
```

Renvoie le statut d’indexation par document. États : `queued`, `running`, `completed`, `failed`.

### Chercher dans la base

```http
POST /api/v1/search
```

```json
{
  "query": "What is our return policy?",
  "file_ids": ["file-id-1", "file-id-2"],
  "top_k": 5,
  "similarity_threshold": 0.0,
  "include_metadata": true
}
```

`file_ids` est requis et cible la recherche sur des documents précis.

### Supprimer un document

```http
DELETE /api/v1/documents/{file_id}
```

### Récupérer le contenu d’un document

```http
GET /api/v1/documents/{file_id}/content
```

Renvoie le texte extrait complet d’un document indexé.

### Comparer des documents

```http
POST /api/v1/documents/compare
```

```json
{
  "file_id_a": "file-id-1",
  "file_id_b": "file-id-2"
}
```

## API Crawler

### Enregistrer un site à crawler

```http
POST /api/v1/websites
```

```json
{
  "domain": "https://docs.example.com",
  "scan_interval": 21600
}
```

`scan_interval` en secondes. Minimum 60.

### Récupérer le contenu d’une page

```http
POST /api/v1/urls/fetch
```

```json
{
  "urls": ["https://docs.example.com/guide"],
  "word_count_threshold": 100
}
```

Renvoie le contenu en cache si disponible, sinon fetch live.

### Infos sur un site

```http
GET /api/v1/websites/{domain}
```

### Déréférencer un site

```http
DELETE /api/v1/websites/{domain}
```

### Lister les URLs d’un site

```http
GET /api/v1/websites/{domain}/urls
```

## API Platform

Le service Platform expose une API publique sur `/api/v1/*` pour l’accès programmatique à tes données. Authentification par clé API depuis **Paramètres > Clés API**.

### Chat completions compatibles OpenAI

La plateforme fournit une interface entièrement compatible avec l’[API OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat). Tout client ou SDK supportant OpenAI (Python, Node, curl, LiteLLM, etc.) peut se connecter en pointant `base_url` vers ton instance Tale.

#### Quick start

<CodeGroup>

```python Python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-tale-instance.com/api/v1",
    api_key="tale_...",  # depuis Paramètres > Clés API
    default_headers={"X-Organization-Slug": "default"},
)

response = client.chat.completions.create(
    model="chat-agent",  # slug d'agent de ta page Agents
    messages=[{"role": "user", "content": "Bonjour !"}],
)
print(response.choices[0].message.content)
```

```typescript Node.js
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://your-tale-instance.com/api/v1',
  apiKey: 'tale_...',
  defaultHeaders: { 'X-Organization-Slug': 'default' },
});

const response = await client.chat.completions.create({
  model: 'chat-agent',
  messages: [{ role: 'user', content: 'Bonjour !' }],
});
console.log(response.choices[0].message.content);
```

```bash curl
curl https://your-tale-instance.com/api/v1/chat/completions \
  -H "Authorization: Bearer tale_..." \
  -H "X-Organization-Slug: default" \
  -H "Content-Type: application/json" \
  -d '{"model":"chat-agent","messages":[{"role":"user","content":"Bonjour !"}]}'
```

</CodeGroup>

#### Authentification

Toutes les requêtes exigent un bearer token dans l’en-tête `Authorization` :

```text
Authorization: Bearer tale_...
```

Crée les clés API dans **Paramètres > Clés API** de l’UI.

#### En-têtes

| En-tête               | Requis | Description                                                                   |
| --------------------- | ------ | ----------------------------------------------------------------------------- |
| `Authorization`       | Oui    | `Bearer <api-key>`.                                                           |
| `X-Organization-Slug` | Non    | slug d’organisation. Résolu automatiquement si le user n’appartient qu’à une. |
| `X-Thread-Id`         | Non    | réutiliser un fil de conversation entre requêtes.                             |

#### Endpoints

##### POST /api/v1/chat/completions

Envoie un message de chat et reçoit une réponse. Supporte streaming et tool calling.

**Body de requête :**

| Champ               | Type             | Description                                                                          |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| `model`             | string           | **Requis.** slug d’agent (ex. `chat-agent`).                                         |
| `messages`          | array            | **Requis.** messages de conversation avec `role` et `content`.                       |
| `stream`            | boolean          | activer le streaming SSE. Défaut : `false`.                                          |
| `temperature`       | number           | température de sampling (0–2).                                                       |
| `max_tokens`        | number           | tokens max à générer.                                                                |
| `top_p`             | number           | paramètre de nucleus sampling.                                                       |
| `frequency_penalty` | number           | pénalise les tokens répétés.                                                         |
| `presence_penalty`  | number           | pénalise les tokens déjà présents.                                                   |
| `stop`              | string ou array  | séquences d’arrêt.                                                                   |
| `response_format`   | object           | `{"type": "json_object"}` pour mode JSON.                                            |
| `tools`             | array            | définitions d’outils pour tool calling côté client.                                  |
| `tool_choice`       | string ou object | `"auto"`, `"required"`, `"none"` ou `{"type":"function","function":{"name":"..."}}`. |

**Deux modes :**

- **Mode agent** (sans `tools`) : l’agent utilise ses outils serveurs préconfigurés (RAG, recherche web, etc.) et les exécute automatiquement. La réponse contient le texte final.
- **Mode outils client** (`tools` fournis) : seuls les outils définis par le client sont disponibles. Le modèle renvoie des `tool_calls` à exécuter côté client. Renvoie les résultats via des messages `role: "tool"`.

**Exemple de tool calling :**

```python
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get weather for a city",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]

# Étape 1 : envoyer les tools
response = client.chat.completions.create(
    model="chat-agent",
    messages=[{"role": "user", "content": "Quel temps fait-il ?"}],
    tools=tools,
    tool_choice="required",
)

# Étape 2 : exécuter l'outil et renvoyer le résultat
tc = response.choices[0].message.tool_calls[0]
messages = [
    {"role": "user", "content": "Quel temps fait-il ?"},
    response.choices[0].message.model_dump(),
    {"role": "tool", "tool_call_id": tc.id, "content": '{"temp": 20}'},
]
final = client.chat.completions.create(
    model="chat-agent", messages=messages, tools=tools
)
print(final.choices[0].message.content)
```

##### GET /api/v1/models

Liste les agents disponibles (modèles).

```json
{
  "object": "list",
  "data": [
    { "id": "chat-agent", "object": "model", "owned_by": "default" },
    { "id": "workflow-assistant", "object": "model", "owned_by": "default" }
  ]
}
```

## Endpoints d'état

Deux endpoints publics et non authentifiés exposent l'état global up/down de la plateforme. Ils partagent la même sonde (cache en mémoire de 5 secondes) et ne diffèrent que par la représentation :

| Endpoint       | Utilisation                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `/status`      | Page d'état HTML lisible. Choisit l'anglais, l'allemand ou le français selon `Accept-Language`.                                   |
| `/status.json` | Flux lisible par machine pour les services de surveillance externes (BetterStack, UptimeRobot, Atlassian Statuspage, Datadog, …). |

Les deux endpoints répondent toujours avec `200 OK` et `Cache-Control: public, max-age=5`. La plateforme elle-même est la source de vérité — si ton service de surveillance n'atteint pas du tout `/status.json`, c'est que le processus de la plateforme est injoignable, et le timeout du service de surveillance est alors le signal.

### Format de la réponse (`/status.json`)

```json
{
  "status": "operational",
  "checkedAt": "2026-05-11T13:45:07.123Z",
  "components": [
    { "id": "convex", "status": "operational" },
    { "id": "rag", "status": "operational" },
    { "id": "crawler", "status": "outage" }
  ]
}
```

| Champ                 | Type   | Valeurs                                                                               |
| --------------------- | ------ | ------------------------------------------------------------------------------------- |
| `status`              | string | `operational`, `degraded` (certains composants en panne) ou `outage` (tous en panne). |
| `checkedAt`           | string | Horodatage ISO 8601 de la dernière sonde.                                             |
| `components[].id`     | string | Identifiant stable du composant : `convex`, `rag` ou `crawler`.                       |
| `components[].status` | string | `operational` ou `outage` par composant.                                              |

Les services de surveillance par mots-clés peuvent déclencher une alerte sur la sous-chaîne sensible à la casse `"status":"outage"`.
