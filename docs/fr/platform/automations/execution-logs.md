---
title: Journaux d'exécution
description: Relire les exécutions passées d'une automatisation, déboguer les échecs, et rejouer avec une nouvelle entrée.
---

L'onglet **Exécutions** de chaque automatisation est le journal par exécution de tout ce qui a tenté de la lancer — planifications, webhooks, événements et exécutions manuelles confondus. Chaque ligne est une exécution, chaque ligne se déplie sur la trace pas-à-pas des entrées, des sorties et des erreurs qui l'ont produite. C'est là qu'un Développeur ou un Admin atterrit quand une API tierce a renvoyé `400` dans la nuit et que la question est « quelle étape, avec quelle charge, contre quel modèle ».

Les exécutions sont conservées selon la [politique de rétention](/fr/platform/admin/governance#aufbewahrung) de l'organisation. Au-delà de cet horizon, les lignes sont supprimées définitivement par le travail de nettoyage quotidien ; déboguer sur la durée veut dire copier la trace avant que cela arrive.

## Un échec détaillé

Clique sur n'importe quelle ligne pour la déplier. Le panneau de détail montre une vue JSON de l'exécution complète, structurée ainsi :

```json
{
  "execution": {
    "id": "exe_…",
    "status": "failed",
    "startedAt": "2026-05-15T09:12:04.317Z",
    "completedAt": "2026-05-15T09:12:06.842Z",
    "triggeredBy": "webhook",
    "error": "Shopify returned 400: 'price' must be a positive number"
  },
  "metadata": { … trigger source, webhook token id, idempotency key … },
  "variables": { … workflow variables at run time … },
  "journal": [
    { "step": "Start", "status": "completed", "input": { … }, "output": { … } },
    { "step": "Fetch order", "status": "completed", "output": { … } },
    { "step": "Create line item", "status": "failed", "error": { … } }
  ]
}
```

Le champ `journal` porte la charge — chaque étape qui s'est exécutée est enregistrée dans l'ordre, avec l'entrée littérale qu'elle a vue, la sortie qu'elle a produite et l'erreur si elle en a levé une. Les étapes en échec restent dépliées par défaut, donc le point de rupture se signale lui-même sans que tu chasses parmi les autres.

## Filtres et recherche

La barre de filtres au-dessus du tableau couvre les cas que tu sors le plus souvent.

| Filtre            | Valeurs                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| **Statut**        | `running`, `completed`, `failed`, `pending`.                                                    |
| **Déclenché par** | `schedule`, `manual`, `event`, `webhook`, `api`, `system`.                                      |
| **Période**       | Aujourd'hui, 7 derniers jours, 30 derniers jours, toute la période, ou un de/à personnalisé.    |
| **Recherche**     | Correspondance exacte sur l'id d'exécution ; utile quand tu as l'id depuis un rapport d'erreur. |

Le tableau charge les exécutions les plus récentes par pages et bascule en défilement infini quand tu descends. Les filtres se combinent — `status: failed` plus `triggered by: webhook` plus les dernières 24 heures resserre sur « qu'est-ce qui a sauté sur le trafic entrant depuis ce matin ».

## Rejouer

Depuis une ligne dépliée, deux actions rejouent l'exécution :

- **Rejouer avec la même entrée** démarre une nouvelle exécution avec la charge d'origine. Utile quand l'automatisation a changé depuis l'échec initial et que tu veux confirmer le correctif.
- **Rejouer avec une autre entrée** ouvre la charge dans un éditeur pour que tu l'ajustes avant le tir. Utile pour sonder des cas limites — change un champ, observe quelle étape se ramifie autrement.

Les nouvelles exécutions arrivent dans l'onglet **Exécutions** comme de nouvelles lignes ; l'échec d'origine reste en place pour que l'historique d'audit reste intact.

## Alertes

L'onglet **Alertes** d'une automatisation te laisse câbler des notifications d'échec vers le courriel d'un Admin — déclencher quand une exécution échoue, qu'elle dépasse un seuil, ou que l'erreur correspond à un motif. Les alertes par automatisation couvrent le cas par automatisation ; pour « plus de cinq échecs dans la dernière heure sur toutes les automatisations de l'organisation », passe plutôt à [Operations](/fr/self-hosted/operate/observability/operations) — il porte l'agrégation inter-automatisations que la surface des alertes ne couvre volontairement pas.

## Où cela s'inscrit

Les journaux d'exécution sont la surface de débogage par automatisation — l'onglet **Exécutions** sur l'automatisation que tu as devant toi. Pour l'agrégation inter-automatisations (exécutions totales, taux de réussite, top automatisations par volume), [Métriques d'automatisation](/fr/platform/automations/metrics) est le tableau de bord. Pour les tendances d'erreurs à l'échelle de l'organisation qui mêlent automatisations et chat, [Operations](/fr/self-hosted/operate/observability/operations) est la bonne surface, un onglet à côté.
