---
title: Appeler Tale depuis un script
description: Crée une clé API et appelle l'API REST de Tale depuis un script bash, Python ou Node — le chemin de bout en bout le plus court du terminal à la réponse d'agent.
---

Appeler Tale depuis un script est le chemin que tu prends quand tu veux récupérer une valeur d'un agent ou d'un workflow sans ouvrir l'UI. L'API Tale parle JSON sur HTTPS et accepte un bearer token dans l'en-tête `Authorization` ; à partir de là, chaque groupe d'endpoints est un appel REST classique. Ce parcours te mène de « je veux scripter Tale » à une réponse streamée dans ton terminal en une seule séance.

Il te faut le rôle Developer (pour créer des clés API), l'URL de ton instance Tale et un shell avec `curl`, Python ou Node. La surface complète de l'API vit dans la [référence de l'API](/fr/develop/api-reference) ; cette page est le parcours de bout en bout le plus court qui la traverse.

## Avant de commencer

Confirme trois choses. Ton instance est joignable en HTTPS — ouvre `https://your-host.example.com` et vérifie que le dashboard charge. Ton rôle est au moins Developer — l'entrée **Paramètres > Clés API** est cachée pour Member et Editor. Tu as au moins un agent publié — lister les agents renvoie un tableau vide sur une instance toute neuve, ce qui rend le test de fumée ambigu.

## Étape 1 — Créer une clé API

Le premier geste est de créer une clé API portant sur ton utilisateur. La clé est ce que chaque appel de script transporte ; sans elle, l'API renvoie 401, et tu ne peux pas relire la clé après la création.

Ouvre **Paramètres > Clés API** et clique **Nouvelle clé**. Donne-lui un nom (`local-script-test`), choisis une expiration et clique **Créer**. Copie la clé que le panneau affiche — Tale la montre une seule fois et plus jamais. Range-la en variable d'environnement pour le reste du parcours :

```bash
export TALE_API_KEY="tk_..."
export TALE_BASE_URL="https://your-host.example.com"
```

La clé hérite de ton rôle ; traite-la comme un mot de passe.

## Étape 2 — Test de fumée avec curl

Le plus petit check de bout en bout est de lister les agents que ta clé peut voir. Si ça marche, l'auth, le réseau et l'API sont bons ; si ça échoue, le mode d'échec te dit lequel est cassé.

```bash
curl -sS "$TALE_BASE_URL/api/v1/agents" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Accept: application/json" | jq
```

Un 200 avec un corps JSON comme `{ "agents": [ ... ] }` confirme l'aller-retour. Un 401 veut dire que la clé est fausse ; un 403 veut dire que la clé est valide mais le rôle trop bas ; toute autre réponse veut dire que l'instance est injoignable ou le chemin faux. Prends un ID d'agent dans la réponse — tu en as besoin à l'étape 3.

## Étape 3 — Appeler un agent depuis Python ou Node

Lister les agents est en lecture seule ; le travail utile arrive quand tu demandes une réponse à un agent. L'endpoint compatible OpenAI est l'entrée la plus simple, parce que les SDK existants tournent sans modification :

```python
from openai import OpenAI
import os

client = OpenAI(
    base_url=f"{os.environ['TALE_BASE_URL']}/api/v1",
    api_key=os.environ["TALE_API_KEY"],
)
reply = client.chat.completions.create(
    model="agt_your_agent_id_here",
    messages=[{"role": "user", "content": "Summarise the last quarter's revenue."}],
)
print(reply.choices[0].message.content)
```

Le champ `model` est l'ID de l'agent ; les instructions, connaissances et outils de l'agent tournent comme configuré. La même forme en Node utilise `openai` depuis npm avec les mêmes `baseURL` et `apiKey`. Le streaming passe par `stream=True` et Server-Sent Events.

## Où ça s'utilise

Un script est le chemin que tu prends quand le plan de données est JSON, pas un écran — tâches cron, checks CI, portails internes. La clé API porte ton rôle, l'endpoint compatible OpenAI est la forme la moins frictionnelle, et chaque endpoint de listing renvoie la même enveloppe `{ resource: [...] }`.

Pour les déclencheurs entrants — ton système POSTe dans un workflow Tale — voir [Déclencher un workflow par webhook](/fr/tutorials/developer/trigger-automation-via-webhook). Pour la liste complète des endpoints et le modèle d'erreur, la [référence de l'API](/fr/develop/api-reference) est la seule source de vérité.
