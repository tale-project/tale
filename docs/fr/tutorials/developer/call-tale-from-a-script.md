---
title: Appeler Tale depuis un script
description: Crée une clé API et appelle l'API REST de Tale depuis un script bash ou Python — le chemin de bout en bout le plus court du terminal à une réponse d'assistant.
---

Appeler Tale depuis un script, c'est le chemin que tu prends quand tu veux une valeur de la plateforme sans ouvrir l'UI. L'API de Tale parle JSON sur HTTPS et prend un bearer token dans le header `Authorization` ; à partir de là, chaque groupe d'endpoints est un appel REST normal. Cette marche t'amène en une séance de « je veux scripter Tale » à une réponse d'assistant imprimée dans ton terminal.

Il te faut un rôle Développeur (pour les clés API), l'URL de ton instance Tale, et un shell avec `curl` et Python. La surface complète vit dans la [référence API](/fr/develop/api-reference) ; cette page en est la traversée de bout en bout la plus courte.

## Avant de commencer

Vérifie trois choses. Ton instance répond en HTTPS — ouvre `https://your-host.example.com` et regarde si le tableau de bord charge. Ton rôle est au moins Développeur — les [clés API](/fr/platform/admin/api-keys) se gèrent avec les rôles Admin et Développeur. Tu connais un modèle configuré dans ton organisation — l'API n'en choisit jamais un à ta place, chaque appel de chat nomme son modèle explicitement.

## Étape 1 — Créer une clé API

Le premier geste est une clé API. C'est elle que chaque appel de script transporte ; sans elle l'API répond 401, et après la création tu ne peux plus la relire.

Crée une clé dans le panneau [Clés API](/fr/platform/admin/api-keys) et copie ce qu'il montre — Tale l'affiche une fois et jamais plus. Range-la en variable d'environnement pour le reste de cette marche :

```bash
export TALE_API_KEY="tale_..."
export TALE_BASE_URL="https://your-host.example.com"
```

La clé t'appartient, à toi et à ton organisation ; ce qu'elle peut faire suit ton rôle. Traite-la comme un mot de passe.

## Étape 2 — Test de fumée avec curl

La plus petite vérification de bout en bout : lister les automatisations de l'organisation. Si ça marche, l'auth, le réseau et l'API vont bien ; si ça échoue, le mode d'échec te dit lequel des trois est cassé.

```bash
curl -sS "$TALE_BASE_URL/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY" | jq
```

Un 200 avec un corps `{ "page": [...], "isDone": true, ... }` confirme l'aller-retour — chaque endpoint de liste répond cette même enveloppe paginée. Un 401 dit que la clé est fausse ; tout le reste dit que l'instance est injoignable ou le chemin mal tapé.

## Étape 3 — Interroger un modèle et lire la réponse

Le chat par l'API est asynchrone : tu postes un message, le tour tourne en arrière-plan, et tu interroges jusqu'à la fin. Trois appels, une boucle :

```python
import os, time, requests

base = os.environ["TALE_BASE_URL"]
auth = {"Authorization": f"Bearer {os.environ['TALE_API_KEY']}"}

# 1. Un thread à toi
thread = requests.post(f"{base}/api/v1/threads", headers=auth, json={}).json()

# 2. Envoyer un message — nomme un modèle configuré dans ton organisation
requests.post(
    f"{base}/api/v1/threads/{thread['id']}/messages",
    headers=auth,
    json={"content": "En une phrase : c'est quoi, Tale ?", "model": "<ton-modele>"},
).raise_for_status()

# 3. Interroger jusqu'à idle, puis lire le dernier message
while True:
    status = requests.get(
        f"{base}/api/v1/threads/{thread['id']}/generation", headers=auth
    ).json()["status"]
    if status == "idle":
        break
    time.sleep(1)

messages = requests.get(
    f"{base}/api/v1/threads/{thread['id']}/messages", headers=auth
).json()["page"]
print(messages[-1]["content"])
```

`{"status": "idle"}` signifie que le tour est fini — y compris un tour raté, qui atterrit comme message d'assistant portant l'erreur au lieu de disparaître. L'envoi répond **202** aussitôt ; la réponse n'existe qu'une fois la boucle sortie de `queued`/`streaming`.

## Étape 4 — Démarrer une exécution d'automatisation

La même forme 202-puis-suivi démarre du vrai travail. Les noms d'automatisation sont des chemins en `/` et s'écrivent avec `__` dans les URL — `billing/dunning` voyage en `billing__dunning` :

```bash
RUN=$(curl -sS -X POST "$TALE_BASE_URL/api/v1/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" -d '{ "input": {} }' | jq -r .runId)

curl -sS "$TALE_BASE_URL/api/v1/runs/$RUN" \
  -H "Authorization: Bearer $TALE_API_KEY" | jq .status
```

Une exécution live demande ton rôle Développeur ; avec `{"mode": "mock"}` tu répètes contre des mocks déterministes, avec n'importe quelle clé de membre. Un 409 dit que l'automatisation n'a pas encore de version déployée.

## Où ça se place

Un script est le chemin quand le plan de données est du JSON, pas un écran — jobs cron, vérifications CI, portails internes. La clé API porte ton rôle, chaque endpoint de liste répond la même enveloppe paginée, et tout ce qui démarre du vrai travail répond 202 et te donne quelque chose à suivre.

Pour les déclencheurs entrants — un système tiers poste dans une automatisation Tale — voir [Déclencher une automatisation par webhook](/fr/tutorials/developer/trigger-automation-via-webhook). Pour un client piloté par modèle plutôt qu'un script, l'[endpoint MCP](/fr/develop/mcp-endpoint) expose la même plateforme en outils. Pour l'inventaire complet et le modèle d'erreur, la [référence API](/fr/develop/api-reference) est la seule source de vérité.
