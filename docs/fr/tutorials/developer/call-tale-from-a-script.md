---
title: Appeler Tale depuis un script
description: Envoyer une requête chat à un agent depuis cURL et Python via l'API OpenAI-compatible de Tale.
---

L'API publique de Tale est OpenAI-compatible — tout SDK qui parle à `chat/completions` peut parler à Tale en changeant deux valeurs : l'URL de base et la clé API. Ce tutoriel enchaîne un appel cURL minimal, le même en Python avec le client officiel `openai`, puis le passage au streaming. La référence complète est dans la [Référence API](/fr/develop/api-reference).

Il te faut un accès Developer pour créer des clés API. Il te faut aussi un agent que tu peux adresser par slug — prends celui de [Construire ton premier agent end-to-end](/fr/tutorials/editor/first-agent-end-to-end), ou n'importe quel agent par défaut.

## Étape 1 — Créer une clé API

Va dans **Paramètres > Clés API** et clique **Créer**. Donne-lui un nom explicite (`cli-dev-laptop`), copie le token — il commence par `tale_` et n'est affiché qu'une fois — et mets-le dans ton gestionnaire de mots de passe ou ton env shell.

```bash
export TALE_API_KEY="tale_..."
export TALE_BASE_URL="https://<ton-instance-tale>/api/v1"
```

## Étape 2 — Lister les agents disponibles

Chaque requête a besoin d'un champ `model` ; les valeurs valides sont les slugs d'agent retournés par `GET /api/v1/models`.

```bash
curl -s "$TALE_BASE_URL/models" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Forme de la réponse :

```json
{
  "object": "list",
  "data": [
    { "id": "chat-agent", "object": "model", "owned_by": "default" },
    { "id": "product-support", "object": "model", "owned_by": "default" }
  ]
}
```

Choisis un slug — dans la suite, on prend `product-support`.

## Étape 3 — Envoyer une requête chat sans streaming

Sans streaming, c'est au plus simple : une requête, une réponse. À utiliser quand tu veux juste le texte final.

```bash
curl -s "$TALE_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "product-support",
    "messages": [
      { "role": "user", "content": "Résume notre politique de retour en 3 points." }
    ]
  }' | jq -r '.choices[0].message.content'
```

La même requête en Python avec le SDK officiel :

```python
from openai import OpenAI
import os

client = OpenAI(
    base_url=os.environ["TALE_BASE_URL"],
    api_key=os.environ["TALE_API_KEY"],
)

response = client.chat.completions.create(
    model="product-support",
    messages=[
        {"role": "user", "content": "Résume notre politique de retour en 3 points."},
    ],
)
print(response.choices[0].message.content)
```

## Étape 4 — Passer au streaming

Le streaming commence à afficher des tokens dès que le modèle les produit — meilleure UX en CLI et en chat, coût total identique. Mets `stream=True` :

```python
stream = client.chat.completions.create(
    model="product-support",
    messages=[
        {"role": "user", "content": "Résume notre politique de retour en 3 points."},
    ],
    stream=True,
)

for chunk in stream:
    delta = chunk.choices[0].delta.content or ""
    print(delta, end="", flush=True)
print()
```

Le format réseau est Server-Sent Events (SSE) ; le SDK gère le parsing. Si tu consommes l'endpoint sans SDK, lis les [notes streaming](/fr/develop/api-reference) de la référence.

## Étape 5 — Réutiliser un thread de conversation

Par défaut, chaque requête est un tour isolé. Pour garder une conversation vivante entre requêtes, envoie l'en-tête optionnel `X-Thread-Id` avec une valeur que tu contrôles. Le même thread ID résout la même conversation dans l'UI Tale, donc les utilisateurs peuvent reprendre où ton script s'est arrêté.

```python
client_with_thread = OpenAI(
    base_url=os.environ["TALE_BASE_URL"],
    api_key=os.environ["TALE_API_KEY"],
    default_headers={"X-Thread-Id": "nightly-report-2026-04-20"},
)
```

Voir [Référence API](/fr/develop/api-reference) pour tous les en-têtes.

## Dépannage

- **401 Unauthorized** — clé `tale_` révoquée, mal saisie, ou préfixe `Bearer` manquant.
- **404 Not Found** sur `/chat/completions` — l'URL de base n'a pas le suffixe `/api/v1`.
- **400 model not found** — le slug d'agent n'existe pas ou est mal orthographié ; revérifie `GET /models`.

## Ensuite

- Brancher le même appel dans une automatisation : [Déclencher une automatisation via webhook](/fr/tutorials/developer/trigger-automation-via-webhook).
- Utiliser le tool calling depuis ton client : [Référence API — Tool calling](/fr/develop/api-reference).
