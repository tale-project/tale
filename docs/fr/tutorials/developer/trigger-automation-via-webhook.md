---
title: Déclencher une automatisation par webhook
description: Ajoute un déclencheur webhook à une automatisation et POSTe sur son URL depuis un système externe pour lancer une exécution de la version déployée.
---

Un déclencheur webhook transforme une automatisation en quelque chose qu'un système externe peut tirer par un POST JSON. Tale compare le jeton de l'URL au déclencheur, et l'exécution lancée appartient à la version déployée de l'automatisation — jamais à un brouillon que quelqu'un est en train de modifier. Ce parcours mène une automatisation de « je veux la tirer depuis l'extérieur » à « un événement de commande arrive et l'exécution apparaît » sur une seule instance.

Il te faut le rôle Développeur dans l'organisation, une automatisation avec une version déployée, et un shell avec `curl`. Le contrat entrant complet — codes de statut, traitement du body, limites de taille — vit dans [Webhooks](/fr/develop/webhooks) ; ce parcours en est le plus petit usage de bout en bout.

## Avant de commencer

Vérifie deux choses. L'automatisation que tu vas déclencher a une version **déployée** — enregistrer une version ne suffit pas, et une version ne devient déployable qu'une fois ses propres tests au vert ; lance-les d'abord. Ton rôle est au moins Développeur ; ajouter des déclencheurs est réservé à Développeur et au-dessus. Si tu n'as pas encore d'automatisation, la plus petite canonique est « enregistre la charge utile puis arrête-toi » — un seul nœud `transform`, construit sur le canvas comme le décrit [L’éditeur de workflow](/fr/platform/automations/editor).

Pour la livraison de projet ci-dessous, choisis un projet actif où cette automatisation est installée. Le projet et le déclencheur doivent appartenir à la même organisation. La [référence API](/fr/develop/api-reference) explique l’installation dans un projet.

## Étape 1 — Ajouter un déclencheur webhook

Le premier geste consiste à lier un déclencheur webhook à l'automatisation. Sans lui, l'automatisation ne part que depuis l'interface ou un planning ; avec lui, elle obtient une URL sur laquelle n'importe quel système peut POSTer.

Ouvre la page de détail de l’automatisation et repère **Déclencheur** dans le panneau de réglages à droite. Sur un écran étroit, ce panneau se trouve sous le canvas. Choisis **Webhook** dans **Type de déclencheur**, puis clique sur **Enregistrer les réglages**. Copie le token dès qu’il apparaît : Tale ne le montre qu’une fois. Le token dans l’URL autorise les livraisons ; Tale ne conserve que son empreinte.

Le déclencheur se lie au **nom** de l'automatisation, pas à la version que tu as déployée. Déploie une nouvelle version demain et cette URL continue de marcher — c'est tout l'intérêt de séparer les deux.

Place le token que tu viens de créer dans l’URL de projet ci-dessous. Le projet vient du chemin, pas des données du fournisseur ni d’un paramètre de requête `projectId`. Une livraison sans projet utilise `/api/automations/webhook/{token}` et exige une automatisation sans aucune liaison de projet.

```bash
export TALE_TRIGGER_URL="https://your-host.example.com/api/projects/<projectId>/automations/webhook/<token>"
```

## Étape 2 — POSTer une charge utile depuis curl

Envoie les données du fournisseur à l’URL du projet. L’exécution reçoit `{ "trigger": "webhook", "payload": <body> }` : l’identifiant de commande de l’exemple se trouve dans `input.payload.orderId`. Si l’automatisation définit un schéma `inputs`, il doit décrire cet objet englobant. Les corps non JSON passent comme texte.

```bash
curl -sS "$TALE_TRIGGER_URL" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

Un appel accepté répond **202** avec `{ "runId": "..." }`. L’exécution continue dans le projet nommé. Suis `GET /api/v1/projects/{id}/runs/{runId}` avec une clé API qui peut lire le projet, ou ouvre la liste des exécutions de l’automatisation dans le produit.

## Étape 3 — Lire les cas d'échec

Cinq réponses couvrent ce parcours. Le statut indique quoi corriger.

**400** signifie que le projet est invalide, archivé ou que l’automatisation n’y est pas installée. Une automatisation liée sur l’URL globale, un paramètre de requête `projectId` ou une entrée hors du schéma déclaré donne aussi **400**. Corrige l’URL, la liaison ou le corps avant de réessayer.

**404** signifie que le jeton ne correspond à aucun déclencheur actif — il est faux, il a été supprimé, ou le déclencheur est désactivé. La réponse ne dit délibérément jamais lequel, pour que celui qui devine des jetons n'apprenne rien de la différence. **409** avec `{ "error": "automation has no deployed version" }` signifie que l'automatisation existe mais que rien n'est en ligne : déploie une version dont les tests passent et le même appel s'exécute. **413** signifie que le body dépasse 256 Ko ; poste alors une référence plutôt que la charge utile. **202** est le seul succès.

Les retries méritent leur propre phrase : le point de terminaison déduplique, un POST retenté ne lance donc pas de seconde exécution. Envoie un identifiant de livraison — `Idempotency-Key`, ou l’en-tête propre à ton fournisseur comme `X-GitHub-Delivery` — et une répétition dans les 24 heures répond avec l’exécution que la première tentative a lancée, marquée `duplicate: true` ; sans identifiant, un corps identique à l’octet en moins de deux minutes est traité de la même façon. Garde l’identifiant stable d’une tentative à l’autre et une requête restée en suspens se relance sans risque. L’exécution elle-même pose aussi un point de reprise à chaque nœud terminé, une exécution reprise après une interruption ne rejoue donc jamais un effet de bord déjà produit. Les identifiants et les corps identiques se comparent dans la même URL de projet. Un autre projet où l’automatisation est installée a ses propres livraisons. Retirer la liaison ou archiver le projet bloque les livraisons suivantes, y compris les réponses de doublon mémorisées.

## Où ça s'utilise

Les déclencheurs webhook sont la couture entrante du moteur d'automatisation — ce sur quoi ton CRM, ton système de commandes ou ta supervision POSTe. Vas-y quand la phrase est « ceci est arrivé chez nous, lance quelque chose là-dessus » ; va vers la [référence API](/fr/develop/api-reference) quand tu veux plutôt une réponse synchrone. La configuration côté déclencheur, et les trois autres façons de lancer la même automatisation, vivent sur [Déclencheurs de workflow](/fr/platform/automations/triggers).
