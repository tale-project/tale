---
title: Déclencher une automatisation par webhook
description: Ajoute un déclencheur webhook à une automatisation et POSTe sur son URL depuis un système externe pour lancer une exécution de la version déployée.
---

Un déclencheur webhook transforme une automatisation en quelque chose qu'un système externe peut tirer par un POST JSON. Tale compare le jeton de l'URL au déclencheur, et l'exécution lancée appartient à la version déployée de l'automatisation — jamais à un brouillon que quelqu'un est en train de modifier. Ce parcours mène une automatisation de « je veux la tirer depuis l'extérieur » à « un événement de commande arrive et l'exécution apparaît » sur une seule instance.

Il te faut le rôle Développeur dans l'organisation, une automatisation avec une version déployée, et un shell avec `curl`. Le contrat entrant complet — codes de statut, traitement du body, limites de taille — vit dans [Webhooks](/fr/develop/webhooks) ; ce parcours en est le plus petit usage de bout en bout.

## Avant de commencer

Vérifie deux choses. L'automatisation que tu vas déclencher a une version **déployée** — enregistrer une version ne suffit pas, et une version ne devient déployable qu'une fois ses propres tests au vert ; lance-les d'abord. Ton rôle est au moins Développeur ; ajouter des déclencheurs est réservé à Développeur et au-dessus. Si tu n'as pas encore d'automatisation, la plus petite canonique est « enregistre la charge utile puis arrête-toi » — construis-la via [Workflow avec approbations](/fr/tutorials/editor/workflow-with-approvals) et retire le nœud d'approbation pour ce parcours.

## Étape 1 — Ajouter un déclencheur webhook

Le premier geste consiste à lier un déclencheur webhook à l'automatisation. Sans lui, l'automatisation ne part que depuis l'interface ou un planning ; avec lui, elle obtient une URL sur laquelle n'importe quel système peut POSTer.

Ouvre l'onglet **Déclencheurs** de l'automatisation et ajoute un webhook. Tale émet une URL dont le chemin porte le justificatif sous forme de jeton — pas de clé séparée, pas d'en-tête Authorization. Le jeton en clair est affiché une seule fois et n'est jamais stocké : copie-le maintenant ; seul son hachage est conservé, ce qui explique que personne ne puisse te retrouver l'URL plus tard.

Le déclencheur se lie au **nom** de l'automatisation, pas à la version que tu as déployée. Déploie une nouvelle version demain et cette URL continue de marcher — c'est tout l'intérêt de séparer les deux.

```bash
export TALE_TRIGGER_URL="https://your-host.example.com/api/automations/webhook/<token>"
```

## Étape 2 — POSTer une charge utile depuis curl

L'URL de webhook est un point de terminaison POST ordinaire, et le body devient l'entrée de l'exécution. Un body qui n'est pas du JSON est transmis tel quel en texte plutôt que refusé : un fournisseur qui poste des données encodées en formulaire atteint donc quand même ton premier nœud.

```bash
curl -sS "$TALE_TRIGGER_URL" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

Un appel accepté répond **202** avec `{ "runId": "..." }`. L'exécution tourne désormais en asynchrone ; ouvre la liste des exécutions de l'automatisation et tu l'y verras avec ta charge utile en entrée.

## Étape 3 — Lire les cas d'échec

Quatre réponses couvrent tout ce que le point de terminaison peut dire, et chacune désigne un correctif différent.

**404** signifie que le jeton ne correspond à aucun déclencheur actif — il est faux, il a été supprimé, ou le déclencheur est désactivé. La réponse ne dit délibérément jamais lequel, pour que celui qui devine des jetons n'apprenne rien de la différence. **409** avec `{ "error": "automation has no deployed version" }` signifie que l'automatisation existe mais que rien n'est en ligne : déploie une version dont les tests passent et le même appel s'exécute. **413** signifie que le body dépasse 256 Ko ; poste alors une référence plutôt que la charge utile. **202** est le seul succès.

Les retries méritent leur propre phrase : le point de terminaison ne déduplique pas, un POST retenté lance donc une seconde exécution. Ce qui rend cela sûr, c'est l'exécution elle-même — chaque nœud terminé pose un point de reprise, une exécution reprise après une interruption ne rejoue donc jamais les effets de bord déjà produits. Là où une exécution _en double_ resterait fausse, transporte ton propre identifiant d'événement dans la charge utile et branche dessus dans le premier nœud.

## Où ça s'utilise

Les déclencheurs webhook sont la couture entrante du moteur d'automatisation — ce sur quoi ton CRM, ton système de commandes ou ta supervision POSTe. Vas-y quand la phrase est « ceci est arrivé chez nous, lance quelque chose là-dessus » ; va vers la [référence API](/fr/develop/api-reference) quand tu veux plutôt une réponse synchrone. La configuration côté déclencheur, et les trois autres façons de lancer la même automatisation, vivent sur [Déclencheurs de workflow](/fr/platform/automations/triggers).
