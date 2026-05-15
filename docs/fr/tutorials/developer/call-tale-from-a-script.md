---
title: Appeler Tale depuis un script
description: Envoyer une requête chat depuis cURL et Python via l'API OpenAI-compatible de Tale.
---

L'API publique de Tale est OpenAI-compatible — n'importe quel SDK qui parle à `/chat/completions` parle à Tale en changeant deux valeurs : l'URL de base et la clé API. Ce tutoriel déroule un appel cURL minimal, le même appel en Python avec le client `openai` officiel, et le passage au streaming. La surface complète — chaque en-tête, chaque paramètre, chaque code d'erreur — vit dans [API — Référence](/fr/develop/api-reference).

Le résultat à la fin est un script fonctionnel qui appelle ton instance Tale depuis ton portable ou un job CI.

## Avant de commencer

Il te faut un compte avec la permission de créer des clés API — les rôles Propriétaire, Admin ou Développeur conviennent. Il te faut aussi une instance Tale joignable en HTTPS depuis l'endroit où le script tournera (ton portable, un runner CI, un serveur). Pour Python, la bibliothèque `openai` est la seule dépendance ; `pip install openai` suffit. Pour cURL, n'importe quel `curl` récent fonctionne.

Aucune configuration côté agent n'est nécessaire pour la requête elle-même — la clé API route à travers ton organisation et utilise le modèle que tu adresses par ID.

## Étape 1 — Créer une clé API

Ouvre **Paramètres > Clés API** et clique sur **Créer**. Donne un nom descriptif à la clé (`cli-dev-laptop`, `ci-runner`) pour pouvoir la révoquer sans toucher d'autres appelants, puis copie le jeton. Le jeton commence par `tale_` et n'est affiché qu'une seule fois — stocke-le dans ton gestionnaire de mots de passe ou une variable d'environnement shell. Fermer la fenêtre sans copier veut dire régénérer.

```bash
export TALE_API_KEY="tale_..."
export TALE_BASE_URL="https://<ton-instance-tale>/api/v1"
```

L'étape a fonctionné quand la liste des clés API montre la nouvelle entrée avec le nom que tu as donné et un horodatage de dernière utilisation de « Jamais ».

## Étape 2 — Lister les modèles disponibles

Chaque requête a besoin d'un champ `model` ; les valeurs valides viennent de `GET /api/v1/models`, qui liste chaque modèle exposé par les fournisseurs de ton organisation. La forme correspond au `/v1/models` d'OpenAI, donc les SDK OpenAI la lisent sans modification.

```bash
curl -s "$TALE_BASE_URL/models" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

La réponse est une liste JSON :

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

Choisis un ID de modèle — la suite du tutoriel suppose `openai/gpt-4o`.

L'étape a fonctionné quand la réponse liste au moins un modèle et que le format d'ID correspond à ce que tu vois dans **Paramètres > Fournisseurs IA**.

## Étape 3 — Envoyer une requête chat sans streaming

Une requête sans streaming renvoie toute la complétion en une seule réponse. Utilise-la quand le script n'affiche pas les tokens à mesure qu'ils arrivent et que seul le texte final t'intéresse.

```bash
curl -s "$TALE_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [
      { "role": "user", "content": "Résume notre politique de retour en 3 points." }
    ]
  }' | jq -r '.choices[0].message.content'
```

La même requête depuis Python avec le SDK OpenAI :

```python
from openai import OpenAI
import os

client = OpenAI(
    base_url=os.environ["TALE_BASE_URL"],
    api_key=os.environ["TALE_API_KEY"],
)

response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[
        {"role": "user", "content": "Résume notre politique de retour en 3 points."},
    ],
)
print(response.choices[0].message.content)
```

L'étape a fonctionné quand le script imprime une réponse cohérente et que ta page **Analyse d'utilisation** dans Tale montre la requête comptée sur la clé API.

## Étape 4 — Passer au streaming

Le streaming imprime les tokens à mesure que le modèle les produit, ce qui passe nettement mieux dans une CLI ou un chat pour toute réponse plus longue qu'une phrase. Le format de fil est Server-Sent Events ; le SDK OpenAI le parse pour toi.

```python
stream = client.chat.completions.create(
    model="openai/gpt-4o",
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

Le coût total et le contenu final sont identiques à la version sans streaming — le streaming change le format de fil, pas le modèle.

L'étape a fonctionné quand des caractères apparaissent progressivement dans ton terminal au lieu d'arriver tous d'un coup.

## Étape 5 — Choisir la bonne organisation quand tu en as plusieurs

Une clé API unique est limitée à un utilisateur, et cet utilisateur peut appartenir à plus d'une organisation. Quand l'utilisateur appartient à exactement une, Tale résout automatiquement ; sinon il faut la nommer avec l'en-tête `X-Organization-Slug` — la valeur est le slug d'organisation visible dans ton URL après `/dashboard/`.

```python
client = OpenAI(
    base_url=os.environ["TALE_BASE_URL"],
    api_key=os.environ["TALE_API_KEY"],
    default_headers={"X-Organization-Slug": "acme"},
)
```

L'étape a fonctionné quand une requête depuis un utilisateur multi-org ne renvoie plus l'erreur `Failed to resolve organization`.

## Dépannage

- **401 Unauthorized** — la clé `tale_` a été révoquée, mal tapée, ou la requête manque le préfixe `Bearer `. Revérifie **Paramètres > Clés API** et l'en-tête `Authorization`.
- **404 Not Found sur `/chat/completions`** — l'URL de base manque le suffixe `/api/v1`, ou le déploiement ne sert pas HTTPS sur l'hôte que tu appelles.
- **400 missing model** — le corps de requête n'a pas de champ `model`. Passe un ID depuis `GET /api/v1/models`.
- **400 Failed to resolve organization** — l'utilisateur derrière la clé API appartient à plus d'une organisation. Envoie `X-Organization-Slug` comme à l'étape 5.

## Où ça s'inscrit

N'importe quel client OpenAI-compatible parle à Tale dès que tu le pointes sur la bonne URL de base et choisis un modèle parmi les fournisseurs de ton organisation — il n'y a pas de SDK spécifique à Tale, et basculer une intégration OpenAI existante veut dire changer deux chaînes. Le bascule en streaming est identique à OpenAI, et l'en-tête `X-Organization-Slug` est la seule particularité Tale dont tu as typiquement besoin.

Deux suites communes : câble le même appel dans une automatisation qui tourne sans invocation explicite de script — [Déclencher une automatisation via webhook](/fr/tutorials/developer/trigger-automation-via-webhook) — ou étends le client pour faire du tool calling, couvert dans [API — Référence](/fr/develop/api-reference).
