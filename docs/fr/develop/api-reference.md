---
title: Référence API
description: Points de terminaison REST pour Platform, RAG et Crawler — chat OpenAI-compatible, indexation de documents et contrôle du crawler.
---

L'API Tale est la surface que ton code appelle quand tu pilotes la conversation, l'indexation ou le crawl au lieu de cliquer dans l'UI. Le service Platform parle une API Chat Completions OpenAI-compatible sous `/api/v1/*` ; RAG et Crawler exposent chacun leur propre surface REST sur leur port. Cette page est l'unique source de vérité pour la forme de fil — chaque point de terminaison, chaque en-tête obligatoire, chaque champ de requête et réponse — et complète le tutoriel sous [Appeler Tale depuis un script](/fr/tutorials/developer/call-tale-from-a-script) pour le parcours détaillé.

La surface Webhooks — Tale recevant des requêtes signées depuis des systèmes externes — vit sous [Webhooks](/fr/develop/webhooks).

## Authentification

Chaque requête à l'API Platform porte un jeton Bearer créé dans **Paramètres > Clés API** :

```text
Authorization: Bearer tale_...
```

Les jetons commencent par `tale_` et sont liés à l'utilisateur qui les crée. Quand cet utilisateur appartient à plus d'une organisation, envoie `X-Organization-Slug: <slug>` pour choisir l'organisation ; Tale résout automatiquement quand l'utilisateur n'appartient qu'à une. RAG et Crawler sont joints via le réseau Docker interne et ne demandent pas d'auth pour les appelants dans le cluster — les exposer à l'extérieur est une décision d'opérateur documentée dans la référence de configuration auto-hébergée.

## Documentation API interactive

Les services Python livrent une UI Swagger pour explorer et tester chaque point de terminaison :

| Service | UI Swagger                 | JSON OpenAPI                       |
| ------- | -------------------------- | ---------------------------------- |
| RAG     | http://localhost:8001/docs | http://localhost:8001/openapi.json |
| Crawler | http://localhost:8002/docs | http://localhost:8002/openapi.json |

L'API Platform n'a pas d'UI Swagger — elle suit la spec OpenAI Chat Completions, donc toute documentation client OpenAI s'applique.

## API Platform — chat completions

La Platform expose une surface Chat Completions OpenAI-compatible sous `/api/v1/*`. Tout client ou SDK qui parle à `chat/completions` d'OpenAI parle à Tale en changeant deux valeurs : l'URL de base et la clé.

### Exemple travaillé — requête minimale viable

La requête la plus petite qui fait quelque chose est un message utilisateur unique adressé à un modèle exposé par tes fournisseurs. L'exemple ci-dessous montre cURL, Python et Node côte à côte ; l'ID de modèle vient de `GET /api/v1/models`.

<CodeGroup>

```python Python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-tale-instance.com/api/v1",
    api_key="tale_...",  # depuis Paramètres > Clés API
    default_headers={"X-Organization-Slug": "default"},
)

response = client.chat.completions.create(
    model="openai/gpt-4o",
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
  model: 'openai/gpt-4o',
  messages: [{ role: 'user', content: 'Bonjour !' }],
});
console.log(response.choices[0].message.content);
```

```bash curl
curl https://your-tale-instance.com/api/v1/chat/completions \
  -H "Authorization: Bearer tale_..." \
  -H "X-Organization-Slug: default" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-4o","messages":[{"role":"user","content":"Bonjour !"}]}'
```

</CodeGroup>

La réponse suit la forme OpenAI — `id`, `object: chat.completion`, `created`, `model`, `choices[].message.content`, `usage`. Le streaming échange `chat.completion` contre `chat.completion.chunk` et émet un chunk par token.

### POST /api/v1/chat/completions

Envoie un message de chat et reçois une réponse. Prend en charge le streaming, le tool calling et le mode JSON.

**En-têtes.** `Authorization` est obligatoire ; `X-Organization-Slug` ne l'est que pour les utilisateurs multi-org.

| Nom                   | Type   | Obligatoire                       | Description                                                         |
| --------------------- | ------ | --------------------------------- | ------------------------------------------------------------------- |
| `Authorization`       | string | Oui                               | `Bearer tale_...` — la clé API depuis **Paramètres > Clés API**.    |
| `X-Organization-Slug` | string | utilisateurs multi-org uniquement | Slug d'organisation. Auto-résolu quand l'utilisateur n'en a qu'une. |
| `Content-Type`        | string | Oui                               | `application/json` pour le corps de requête.                        |

**Corps de requête.**

| Nom                 | Type             | Obligatoire | Description                                                                                              |
| ------------------- | ---------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `model`             | string           | Oui         | ID de modèle fournisseur, par ex. `openai/gpt-4o`. À lister avec `GET /api/v1/models`.                   |
| `messages`          | array            | Oui         | Historique de conversation. Chaque entrée a `role` et `content` ; les tool calls suivent la spec OpenAI. |
| `stream`            | boolean          | Non         | Streamer la réponse en Server-Sent Events. Défaut `false`.                                               |
| `temperature`       | number           | Non         | Température d'échantillonnage, 0–2.                                                                      |
| `max_tokens`        | number           | Non         | Tokens maximum à générer.                                                                                |
| `top_p`             | number           | Non         | Paramètre de nucleus sampling.                                                                           |
| `frequency_penalty` | number           | Non         | Pénaliser les tokens répétés.                                                                            |
| `presence_penalty`  | number           | Non         | Pénaliser les tokens déjà présents.                                                                      |
| `stop`              | string ou array  | Non         | Séquences d'arrêt.                                                                                       |
| `response_format`   | object           | Non         | Mettre `{"type":"json_object"}` pour le mode JSON.                                                       |
| `tools`             | array            | Non         | Définitions d'outils pour tool calling côté client.                                                      |
| `tool_choice`       | string ou object | Non         | `"auto"`, `"required"`, `"none"` ou `{"type":"function","function":{"name":"..."}}`.                     |
| `stream_options`    | object           | Non         | `{"include_usage": true}` ajoute un chunk final d'usage à une réponse streamée.                          |
| `seed`              | number           | Non         | Indication de déterminisme en best-effort. Le comportement varie selon le fournisseur.                   |

**Deux modes.** Sans `tools`, la requête tourne en **mode modèle direct** — Tale route par ID de modèle et renvoie la complétion du modèle telle quelle. Avec `tools`, la requête tourne en **mode outil client** — le modèle renvoie `tool_calls` au lieu d'une réponse finale, le client les exécute, et une requête de suivi renvoie les résultats comme messages `role: "tool"`.

**Exemple de tool calling.**

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Obtenir la météo actuelle d'une ville.",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
                "required": ["city"],
            },
        },
    }
]

# Premier appel : le modèle décide d'appeler l'outil.
response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "Quel temps fait-il à Zurich ?"}],
    tools=tools,
    tool_choice="required",
)
tc = response.choices[0].message.tool_calls[0]

# Deuxième appel : renvoyer le résultat de l'outil.
final = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[
        {"role": "user", "content": "Quel temps fait-il à Zurich ?"},
        response.choices[0].message.model_dump(),
        {"role": "tool", "tool_call_id": tc.id, "content": '{"temp": 18}'},
    ],
    tools=tools,
)
print(final.choices[0].message.content)
```

### GET /api/v1/models

Liste chaque modèle exposé par les fournisseurs de l'organisation. La forme correspond à `/v1/models` d'OpenAI.

```json
{
  "object": "list",
  "data": [
    {
      "id": "openai/gpt-4o",
      "object": "model",
      "created": 1747325000,
      "owned_by": "openai-main"
    },
    {
      "id": "anthropic/claude-3-5-sonnet",
      "object": "model",
      "created": 1747325000,
      "owned_by": "anthropic-main"
    }
  ]
}
```

`owned_by` porte le slug du fournisseur — utile pour distinguer deux fournisseurs qui exposent le même ID de modèle amont.

## API RAG — indexation et recherche de documents

Le service RAG gère l'indexation de documents et la recherche vectorielle. C'est le moteur derrière la base de connaissances ; l'UI de la plateforme délègue chaque recherche et téléversement à cette surface. Le service écoute sur le port `8001` par défaut.

### Exemple travaillé — indexer et chercher

Un flux end-to-end minimal téléverse un document, attend la fin de l'indexation et lance une recherche limitée à ce document :

```bash
curl -X POST http://localhost:8001/api/v1/documents/upload \
  -F "file=@policy.pdf" \
  -F "file_id=policy-pdf-1" \
  -F "sync=true"

curl -X POST http://localhost:8001/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query":"Quelle est notre politique de retour ?","file_ids":["policy-pdf-1"],"top_k":5}'
```

Le paramètre `sync=true` fait que le téléversement bloque jusqu'à la fin de l'indexation ; sans lui, la réponse revient immédiatement et le document s'indexe en tâche de fond.

### POST /api/v1/documents/upload

Téléverse un document pour indexation. Multipart form-data.

| Nom        | Type    | Obligatoire | Description                                            |
| ---------- | ------- | ----------- | ------------------------------------------------------ |
| `file`     | file    | Oui         | Le fichier binaire à indexer.                          |
| `file_id`  | string  | Oui         | Identifiant stable assigné par l'appelant.             |
| `sync`     | boolean | Non         | Attendre la fin de l'indexation. Défaut `false`.       |
| `metadata` | string  | Non         | Métadonnées JSON-encodées stockées à côté du document. |

### POST /api/v1/documents/statuses

Vérifie le statut d'indexation pour un ou plusieurs documents.

```json
{ "file_ids": ["policy-pdf-1", "manual-pdf-2"] }
```

Renvoie chaque `file_id` avec un statut parmi `queued`, `running`, `completed`, `failed`.

### POST /api/v1/search

Lance une recherche vectorielle limitée à des documents précis.

| Nom                    | Type    | Obligatoire | Description                                                                       |
| ---------------------- | ------- | ----------- | --------------------------------------------------------------------------------- |
| `query`                | string  | Oui         | Requête en langage naturel.                                                       |
| `file_ids`             | array   | Oui         | Documents auxquels limiter la recherche. Obligatoire — pas de « tout » implicite. |
| `top_k`                | number  | Non         | Nombre maximum de chunks renvoyés. Défaut `5`.                                    |
| `similarity_threshold` | number  | Non         | Similarité cosinus minimale, 0–1.                                                 |
| `include_metadata`     | boolean | Non         | Inclure les métadonnées par chunk dans la réponse.                                |

### DELETE /api/v1/documents/{file_id}

Retire un document et ses entrées d'index.

### GET /api/v1/documents/{file_id}/content

Renvoie le texte extrait complet d'un document indexé.

### POST /api/v1/documents/compare

Compare deux documents indexés.

```json
{ "file_id_a": "policy-2024", "file_id_b": "policy-2025" }
```

## API Crawler — sites web et fetch à la demande

Le service Crawler enregistre des sites pour l'indexation périodique et expose un point de terminaison de fetch d'URL à la demande. Il écoute sur le port `8002` par défaut.

### Exemple travaillé — enregistrer et fetch

```bash
curl -X POST http://localhost:8002/api/v1/websites \
  -H "Content-Type: application/json" \
  -d '{"domain":"https://docs.example.com","scan_interval":21600}'

curl -X POST http://localhost:8002/api/v1/urls/fetch \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://docs.example.com/guide"],"word_count_threshold":100}'
```

`scan_interval` est en secondes ; minimum 60. Le point de terminaison de fetch renvoie le contenu en cache quand disponible, et fait un fetch en direct sinon.

### POST /api/v1/websites

Enregistre un site pour crawl périodique.

| Nom             | Type   | Obligatoire | Description                                                        |
| --------------- | ------ | ----------- | ------------------------------------------------------------------ |
| `domain`        | string | Oui         | URL complète de la racine du site.                                 |
| `scan_interval` | number | Non         | Secondes entre les scans. Minimum 60. Défaut configuré au service. |

### POST /api/v1/urls/fetch

Fetch une ou plusieurs URL de manière synchrone.

| Nom                    | Type   | Obligatoire | Description                                                                    |
| ---------------------- | ------ | ----------- | ------------------------------------------------------------------------------ |
| `urls`                 | array  | Oui         | URL à fetch.                                                                   |
| `word_count_threshold` | number | Non         | Rejette les résultats en dessous de cette longueur (filtre les pages de menu). |

### GET /api/v1/websites/{domain}

Renvoie l'enregistrement d'un site.

### DELETE /api/v1/websites/{domain}

Déregistre un site. Les pages déjà indexées restent cherchables jusqu'à expiration.

### GET /api/v1/websites/{domain}/urls

Liste chaque URL que le crawler a indexée pour le site.

## Endpoints de statut

La plateforme expose deux points de terminaison publics non authentifiés qui rapportent l'état global up/down. Les deux partagent le même sondage en mémoire avec un cache de cinq secondes ; ils diffèrent uniquement par la représentation.

| Endpoint       | Usage                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/status`      | Page HTML lisible par un humain. Langue choisie depuis `Accept-Language` (anglais, allemand, français).                         |
| `/status.json` | Flux machine-lisible pour les monitors externes — BetterStack, UptimeRobot, Statuspage, Datadog, tout ce qui interroge du JSON. |

Les deux renvoient `200 OK` et `Cache-Control: public, max-age=5`. La plateforme est la source de vérité — si un monitor ne joint pas du tout `/status.json`, le processus est injoignable et le timeout du monitor est le signal. La forme JSON est couverte en détail sous [Page de statut](/fr/develop/status-page).

## Où ça s'inscrit

L'API est la surface sortante de Tale — ce que ton code appelle quand tu pilotes la conversation, l'indexation ou le crawl. Son pendant entrant est [Webhooks](/fr/develop/webhooks) : la même famille de protocole, le même journal d'audit, avec Tale du côté récepteur au lieu d'appelant. Tout client qui parle à `/chat/completions` d'OpenAI parle à Tale en changeant deux valeurs (URL de base et clé) ; tout système qui peut POST du JSON sur une URL unique peut piloter un workflow.

Pour le tutoriel qui parcourt les deux directions end-to-end, [Appeler Tale depuis un script](/fr/tutorials/developer/call-tale-from-a-script) couvre le côté API et [Déclencher une automatisation via webhook](/fr/tutorials/developer/trigger-automation-via-webhook) couvre le côté webhook entrant.
