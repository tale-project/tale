---
title: Déclencher une automatisation via webhook
description: Brancher un système externe sur un workflow Tale via une URL webhook à jeton unique.
---

Les déclencheurs webhook transforment chaque événement externe — soumission de formulaire, hook d'un système amont, étape CI, slash command Slack — en un lancement de workflow Tale. Le service externe envoie du JSON en POST à une URL qui contient un jeton unique ; le jeton est l'identifiant, et le workflow démarre avec ce JSON comme entrée. Ce tutoriel déroule la création d'un workflow minimal, l'exposition de son webhook, l'envoi d'une requête et la vérification de la livraison. La référence vit dans [Webhooks](/fr/develop/webhooks) et [Déclencheurs](/fr/platform/automations/triggers).

Le résultat à la fin est un workflow appelable depuis l'extérieur que tu peux piloter depuis n'importe quel client HTTPS.

## Avant de commencer

Il te faut un rôle qui peut créer et publier des workflows — Propriétaire, Admin ou Développeur conviennent. Il te faut aussi une instance Tale joignable en HTTPS depuis l'endroit où tourne l'appelant externe ; pour un test local l'appelant est ton portable, en production c'est le système amont qui fait le POST. Pas de compte de service externe, pas de clé API — le jeton webhook est son propre identifiant.

## Étape 1 — Créer un workflow avec un déclencheur webhook

Ouvre **Automatisations** dans la barre latérale et clique sur **Créer un workflow**. Donne-lui un slug (`incoming-order-intake`) — les slugs sont compatibles URL et permanents en pratique, puisque l'URL webhook ne contient rien d'autre qui identifie le workflow. Ouvre le panneau **Déclencheurs** et ajoute un déclencheur **Webhook**. Tale génère une URL unique de la forme :

```text
https://<ton-instance-tale>/api/workflows/wh/<TOKEN>
```

Le jeton fait 64 caractères hexadécimaux et est le seul identifiant — quiconque détient l'URL peut poster des événements vers le workflow. Traite-la comme tu traiterais une clé API : range-la dans le gestionnaire de secrets de l'appelant, ne la commit jamais.

L'étape a fonctionné quand le panneau de déclencheur montre l'URL et un bouton « Copier » à côté.

## Étape 2 — Référencer la charge utile dans une étape

Le corps du POST devient l'entrée du workflow, adressable comme `{{ trigger.body }}` dans chaque étape. Ajoute une étape **LLM** après le déclencheur et référence l'entrée dans le prompt :

```text
Classifie cette saisie de commande comme urgent, normal ou follow-up.

Charge utile :
{{ trigger.body | json }}
```

Le filtre `| json` rend tout le corps comme chaîne JSON que le modèle peut lire. La syntaxe complète des filtres et variables vit dans [Workflows](/fr/platform/automations/workflows).

L'étape a fonctionné quand l'aperçu de l'étape montre le prompt avec le marqueur de placeholder encore visible (le corps se résout à l'exécution, pas à l'aperçu).

## Étape 3 — Publier et appeler le webhook

Enregistre le workflow et bascule **Publier** pour que le déclencheur soit en ligne ; les workflows non publiés rejettent les POST webhook avec `403`. Appelle ensuite l'URL depuis ton appelant :

```bash
curl -X POST "https://<ton-instance-tale>/api/workflows/wh/<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"customerId":"c-42","priority":"high","lines":3}'
```

Le POST renvoie immédiatement un `200 OK` avec un petit corps :

```json
{ "status": "accepted", "workflowSlug": "incoming-order-intake" }
```

Le workflow lui-même tourne de manière asynchrone. Tale planifie l'exécution dans une file d'arrière-plan ; l'appelant ne bloque jamais en attendant la sortie du workflow.

L'étape a fonctionné quand le statut de réponse est `200` et que le corps correspond à la forme ci-dessus.

## Étape 4 — Vérifier l'exécution

Ouvre l'onglet **Exécutions** du workflow pour voir l'exécution. Chaque ligne montre la charge utile du déclencheur, les entrées et sorties de chaque étape, et la durée totale. Filtre par horodatage ou statut pour trouver une exécution précise. Cet onglet est la surface canonique de débogage — quand une étape échoue, son message d'erreur et sa stack trace sont ici, pas dans la réponse HTTP.

L'étape a fonctionné quand l'onglet Exécutions montre une nouvelle ligne avec la charge utile envoyée et un statut `succeeded` vert.

## Étape 5 — Ajouter l'idempotence pour des relances sûres

Si ton appelant relance de lui-même — réseau capricieux, étape CI qui tourne deux fois, webhook Stripe livré plus d'une fois — les POST en double déclencheront des exécutions en double. Envoie un en-tête `X-Idempotency-Key` stable pour rendre les relances côté appelant sûres ; Tale reconnaît la deuxième livraison et renvoie l'exécution originale sans en démarrer une nouvelle.

```bash
curl -X POST "https://<ton-instance-tale>/api/workflows/wh/<TOKEN>" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: order-2026-05-15-42" \
  -d '{"customerId":"c-42","priority":"high","lines":3}'
```

Une livraison en double renvoie :

```json
{ "status": "duplicate", "executionId": "exec_..." }
```

Choisis une clé stable d'une relance à l'autre et unique d'un événement distinct à l'autre — la plupart des appelants utilisent l'ID d'événement amont.

L'étape a fonctionné quand un second POST avec la même clé renvoie `status: "duplicate"` et qu'aucune nouvelle ligne n'apparaît dans **Exécutions**.

## Dépannage

- **404 Invalid webhook token** — le jeton dans l'URL est faux, ou le déclencheur a été supprimé puis recréé (la régénération frappe un nouveau jeton). Recopie l'URL depuis le panneau Déclencheurs du workflow.
- **403 Webhook is disabled** — l'interrupteur du déclencheur est éteint, ou le workflow lui-même n'est pas publié. Active les deux dans le panneau Déclencheurs.
- **400 Invalid JSON payload** — le corps de requête n'est pas du JSON valide, souvent parce qu'un middleware côté appelant a retiré des guillemets ou envoyé un corps form-encoded. Envoie du JSON brut avec `Content-Type: application/json`.
- **429 Rate limit exceeded** — l'IP de l'appelant a dépassé la limite par IP. Bride l'appelant ou répartis sur plus de workflows.

## Où ça s'inscrit

Tu as maintenant un système externe qui peut piloter un workflow Tale : un point de terminaison HTTPS, un identifiant à jeton unique, une exécution asynchrone, et un onglet Exécutions où chaque étape est débogable. La même forme — jeton dans l'URL, réponse `202`-like immédiate, exécution asynchrone — s'applique à toute source que tu peux brancher, d'un webhook Stripe à un job CI à un slash command Slack, en ne changeant que l'appelant.

S'il te faut une réponse directe d'un agent plutôt qu'un lancement de workflow, le même protocole s'applique aux webhooks d'agent sous [Webhooks — Webhooks d'agent](/fr/develop/webhooks#agent-webhooks). Pour recevoir des webhooks sortants de Tale dans ton propre service, [Webhooks](/fr/develop/webhooks) couvre le côté vérification.
