---
title: Logs d'exécution
description: Inspecte les runs passés, débogue les échecs et relance avec ajustements.
---

L'onglet Executions d'un workflow liste chaque run — calendrier, événement, webhook ou manuel — avec dates, durée, statut final et détail par étape.

## Ce qu'affiche un enregistrement d'execution

Clique une ligne pour ouvrir le panneau de détail :

- **Overview** — type de trigger, dates, durée, statut final et payload d'entrée complet.
- **Steps** — chaque étape avec statut (succès, échec, ignorée), entrée, sortie, durée et message d'erreur.
- **Variables** — les variables du workflow au moment du run (utile si tu les as changées depuis).
- **Raw** — trace JSON complète du run, exportable.

Les étapes échouées sont dépliées par défaut pour voir l'erreur sans clic.

## Filtrer et chercher

La table Executions supporte :

- **Filtre statut** — succès, échec, en cours, annulé.
- **Plage temporelle** — dernière heure, 24 h, 7 jours, personnalisée.
- **Filtre trigger** — calendrier, événement, webhook, manuel.
- **Recherche texte** — sur nom de trigger, message d'erreur, entrée/sortie d'étapes.

## Relancer

Depuis le panneau de détail d'un run :

- **Rerun with same input** — lance un nouveau run avec le même payload d'entrée. Utile si le workflow a changé et que tu veux rejouer une requête passée.
- **Rerun with different input** — édite le payload avant de relancer. Utile pour les edge cases.

Les reruns apparaissent comme de nouvelles executions — l'original est préservé.

## Rétention

Les executions sont conservées selon la [politique de rétention](/fr/platform/admin/governance) de ton organisation. Par défaut, les détails des étapes restent 90 jours et les résumés un an.

## Alertes

Configure les alertes dans l'onglet Alerts du workflow pour notifier un admin par e-mail quand un workflow échoue, dure plus qu'un seuil ou produit une erreur qui matche un pattern. Pour des alertes cross-workflow (ex. "plus de 5 échecs par heure tous workflows confondus"), utilise [Operations](/fr/self-hosted/operate/observability/operations).
