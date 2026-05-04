---
title: Déclencher une automatisation via webhook
description: Brancher un système externe sur un workflow Tale via une requête webhook signée.
---

Les triggers webhook transforment tout événement externe — un submit de formulaire, un hook de système amont, une étape CI/CD — en un run d’automatisation Tale. Le service externe POST du JSON sur une URL que tu contrôles ; le workflow démarre avec ce payload en entrée. Ce tutoriel déroule : créer un workflow minimal, exposer son webhook, envoyer une requête signée, vérifier la livraison. La référence est dans [Webhooks](/fr/develop/webhooks) et [Triggers](/fr/platform/automations/triggers).

Il te faut un accès Developer. Une instance Tale joignable en HTTPS par l’appelant externe suffit — rien d’autre à prévoir.

## Étape 1 — Créer un workflow avec un trigger webhook

Ouvre **Automatisations** dans la barre latérale et clique **Nouveau workflow**. Donne-lui un nom (`incoming-order-intake`) et ouvre l’étape **Start**. Dans **Triggers**, ajoute un **Trigger webhook**. Tale génère une URL unique de la forme :

```text
https://<ton-instance-tale>/api/webhooks/workflow/<workflow-id>
```

Définis un **secret webhook** — n’importe quelle chaîne à forte entropie. C’est le secret partagé qui sert à signer et à vérifier les requêtes. Stocke-le dans le gestionnaire de secrets de ton appelant.

## Étape 2 — Ajouter une étape qui utilise le payload

Le corps du webhook devient l’entrée du workflow. Ajoute une étape **LLM** après Start et référence l’entrée dans le prompt :

```text
Classe cette prise de commande en urgent, normal ou à rappeler :

{{ trigger.body | json }}
```

Voir [Workflows](/fr/platform/automations/workflows) pour la palette d’étapes complète et la syntaxe des variables.

Sauvegarde le workflow et passe-le en **Publier** pour que le webhook soit actif.

## Étape 3 — Appeler le webhook depuis l’extérieur

Tale signe chaque requête entrante avec HMAC-SHA-256 si un secret est défini. L’appelant doit faire de même ; Tale rejette les requêtes non signées ou mal signées.

```bash
BODY='{"customerId":"c-42","priority":"high","lines":3}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/.* //')"

curl -X POST "https://<ton-instance-tale>/api/webhooks/workflow/<workflow-id>" \
  -H "Content-Type: application/json" \
  -H "X-Tale-Signature: $SIG" \
  -d "$BODY"
```

Réponse :

```json
{ "executionId": "exec_..." }
```

Le POST revient immédiatement avec un ID d’exécution — le workflow tourne de manière asynchrone.

## Étape 4 — Vérifier le run

Ouvre le workflow et clique l’onglet **Executions**. Filtre par ID d’exécution ou par horodatage ; tu vois le payload du trigger, l’entrée et la sortie de chaque étape, et le temps total. C’est là que tu débogues les échecs. Voir [Journaux d’exécution](/fr/platform/automations/execution-logs) pour la vue complète.

## Étape 5 — Ajouter retries et idempotence (durcissement prod)

- **Retries :** Tale retente les réponses non-2xx en backoff exponentiel jusqu’à cinq tentatives. Si ton appelant retente de son côté, chaque tentative doit envoyer le même body — sinon la signature ne tiendra pas.
- **Idempotence :** inclue un ID de requête stable dans le body (`requestId`). La première étape du workflow peut brancher sur « cet ID a-t-il déjà été vu ? » pour éviter que des livraisons en double ne produisent des effets en double.
- **Rotation du secret :** change le secret dans l’UI Tale, propage-le à la config de l’appelant, puis redéploie. Un court recouvrement est inévitable ; un fail-open bref est acceptable si c’est viable chez toi.

## Dépannage

- **401 invalid signature** — le body signé n’est pas identique octet par octet à celui envoyé (souvent à cause d’un middleware qui pretty-print le JSON).
- **404 workflow not found** — le workflow a été supprimé ou son ID a changé ; recopie l’URL depuis l’étape Start.
- **5xx** — regarde l’onglet Executions pour l’étape qui échoue. Le corps de réponse HTTP contient le résumé d’erreur.

## Ensuite

- Croiser avec [Webhooks](/fr/develop/webhooks) pour des exemples de vérification de signature en Node et Python.
- Utiliser les webhooks d’agent plutôt que de workflow, quand tu veux une réponse d’agent directe sans couche d’automatisation : [Webhooks](/fr/develop/webhooks).
