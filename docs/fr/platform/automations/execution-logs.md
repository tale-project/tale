---
title: Journaux d’exécution
description: Inspecte les runs passés, débogue les échecs et relance avec ajustements.
---

L'onglet Exécutions d'un workflow liste chaque run — calendrier, événement, webhook ou manuel — avec dates, durée, statut final et détail par étape. C'est l'endroit où tu vas quand un workflow a tourné et que tu dois savoir exactement ce qui s'est passé : quelle étape a échoué, quelle entrée elle a vue, quelle sortie elle a produite, à quoi ressemblait l'état des variables à ce moment précis.

Les exécutions sont conservées pendant la période configurée dans [Gouvernance — Rétention](/fr/platform/admin/governance#rétention) ; au-delà, les lignes sont hard-deleted par le runner de nettoyage quotidien. Pour un débogage longue durée, copie la trace avant que la rétention ne la rattrape.

## Ce qu'affiche un enregistrement d'exécution

Clique une ligne pour ouvrir le panneau de détail :

- **Aperçu** — type de trigger, dates, durée, statut final et payload d’entrée complet.
- **Étapes** — chaque étape avec statut (succès, échec, ignorée), entrée, sortie, durée et message d’erreur.
- **Variables** — les variables du workflow au moment du run (utile si tu les as changées depuis).
- **Brut** — trace JSON complète du run, exportable.

Les étapes échouées sont dépliées par défaut pour voir l’erreur sans clic.

## Filtrer et chercher

La table Exécutions supporte :

- **Filtre statut** — succès, échec, en cours, annulé.
- **Plage temporelle** — dernière heure, 24 h, 7 jours, personnalisée.
- **Filtre trigger** — calendrier, événement, webhook, manuel.
- **Recherche texte** — sur nom de trigger, message d’erreur, entrée/sortie d’étapes.

## Relancer

Depuis le panneau de détail d’un run :

- **Relancer avec la même entrée** — lance un nouveau run avec le même payload d’entrée. Utile si le workflow a changé et que tu veux rejouer une requête passée.
- **Relancer avec une entrée différente** — édite le payload avant de relancer. Utile pour les edge cases.

Les reruns apparaissent comme de nouvelles exécutions — l’original est préservé.

## Rétention

Les exécutions sont conservées selon la [politique de rétention](/fr/platform/admin/governance) de ton organisation. Par défaut, les détails des étapes restent 90 jours et les résumés un an.

## Alertes

Configure les alertes dans l’onglet Alertes du workflow pour notifier un Admin par email quand un workflow échoue, dure plus qu’un seuil ou produit une erreur qui matche un pattern. Pour des alertes cross-workflow (ex. "plus de 5 échecs par heure tous workflows confondus"), utilise [Opérations](/fr/self-hosted/operate/observability/operations).
