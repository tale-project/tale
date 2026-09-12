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
export TALE_ORG_SLUG="<org-slug>"
```

La clé agit en ton nom dans l’organisation choisie par `TALE_ORG_SLUG` ; ton appartenance et ton rôle fixent ses droits. Avec plusieurs appartenances, l’en-tête d’organisation est obligatoire pour les écritures et toutes les routes de projet. Garde la clé comme un mot de passe.

## Étape 2 — Test de fumée avec curl

La plus petite vérification de bout en bout : lister les automatisations de l'organisation. Si ça marche, l'auth, le réseau et l'API vont bien ; si ça échoue, le mode d'échec te dit lequel des trois est cassé.

```bash
curl -sS --compressed "$TALE_BASE_URL/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" | jq
```

Un 200 avec un corps `{ "automations": [...] }` confirme l'aller-retour. Un 401 dit que la clé est fausse ; tout le reste dit que l'instance est injoignable ou le chemin mal tapé.

## Étape 3 — Interroger un modèle et lire la réponse

Le chat par API est asynchrone : envoie un message, interroge le statut pendant le tour, puis lis la réponse. Cet exemple crée un thread personnel sans projet. Pour un chat de projet, donne à `threads_url` la valeur `f"{base}/api/v1/projects/{os.environ['TALE_PROJECT_ID']}/threads"`. Tous les appels suivants gardent ce projet, sans `projectId` dans le corps. L’accès en lecture au projet actif est requis ; le rôle Membre suffit.

```python
import os, time, requests

base = os.environ["TALE_BASE_URL"]
auth = {
    "Authorization": f"Bearer {os.environ['TALE_API_KEY']}",
    "X-Organization-Slug": os.environ["TALE_ORG_SLUG"],
}
threads_url = f"{base}/api/v1/threads"

# 1. Un thread à toi
thread = requests.post(threads_url, headers=auth, json={}).json()

# 2. Envoyer un message — nomme un modèle configuré dans ton organisation
requests.post(
    f"{threads_url}/{thread['id']}/messages",
    headers=auth,
    json={"content": "En une phrase : c'est quoi, Tale ?", "model": "<ton-modele>"},
).raise_for_status()

# 3. Interroger jusqu'à idle, puis lire le dernier message
while True:
    status = requests.get(
        f"{threads_url}/{thread['id']}/generation", headers=auth
    ).json()["status"]
    if status == "idle":
        break
    time.sleep(1)

messages = requests.get(
    f"{threads_url}/{thread['id']}/messages", headers=auth
).json()["page"]
reply = messages[-1]
print("".join(p["text"] for p in reply["parts"] if p.get("type") == "text"))
```

`{"status": "idle"}` signifie qu’aucun tour ne tourne. Lis les messages pour trouver la réponse ou une erreur du modèle. L’envoi répond **202** avant la fin du travail. Si tu perds l’accès ou déplaces le thread avant l’ouverture du tour en attente, le worker le refuse. La [référence API](/fr/develop/api-reference) précise les règles de projet.

## Étape 4 — Démarrer une exécution d'automatisation

Choisis un projet actif que tu peux modifier et une automatisation déployée pour ce projet, puis définis son `TALE_PROJECT_ID` ci-dessous. L’exemple utilise `billing/dunning`. Les noms contenant `/` s’écrivent avec `__` dans les URL : ici, `billing__dunning`. Le démarrage et le suivi nomment le même projet :

```bash
export TALE_PROJECT_ID="<projectId>"
RUN=$(curl -sS --compressed -X POST "$TALE_BASE_URL/api/v1/projects/$TALE_PROJECT_ID/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" \
  -H "Content-Type: application/json" -d '{ "input": {} }' | jq -r .runId)

curl -sS --compressed "$TALE_BASE_URL/api/v1/projects/$TALE_PROJECT_ID/runs/$RUN?fields=status,finishedAt" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" | jq .status
```

Une exécution live exige ton rôle Développeur et l’accès en édition au projet. `{"mode": "mock"}` utilise des mocks déterministes, mais demande toujours les droits d’édition. Un 409 signifie qu’aucune version déployée n’est disponible pour cet appel. Si l’automatisation a des liaisons, le projet choisi doit en faire partie ; installe-la dedans au préalable si nécessaire. La [référence API](/fr/develop/api-reference) explique l’installation et les exécutions sans projet.

## Où ça se place

Un script est le chemin quand le plan de données est du JSON, pas un écran — jobs cron, vérifications CI, portails internes. La clé API porte ton rôle, et tout ce qui démarre du vrai travail répond 202 et te donne quelque chose à suivre.

Pour les déclencheurs entrants — un système tiers poste dans une automatisation Tale — voir [Déclencher une automatisation par webhook](/fr/tutorials/developer/trigger-automation-via-webhook). Pour un client piloté par modèle plutôt qu'un script, l'[endpoint MCP](/fr/develop/mcp-endpoint) expose la même plateforme en outils. Pour l'inventaire complet et le modèle d'erreur, la [référence API](/fr/develop/api-reference) est la seule source de vérité.
