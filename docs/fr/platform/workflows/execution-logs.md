---
title: Journaux d'exécution
description: L'historique des exécutions par workflow — chaque exécution avec son statut, sa durée, sa source de déclencheur, les entrées et sorties d'étapes et le journal complet de ce que chaque étape a fait. Les Développeurs et Éditeurs lisent ceci quand une exécution a échoué ou s'est comportée bizarrement.
---

Les journaux d'exécution sont l'historique d'exécutions pour un seul workflow. Chaque fois qu'un déclencheur tire le workflow, Tale ouvre un nouvel enregistrement d'exécution et y écrit pendant que l'exécution avance — heure de début, statut, l'entrée que le déclencheur a portée, la sortie que chaque étape a émise, la durée et l'erreur si une étape a échoué. La page est la surface de débogage que chaque autre surface de workflow pointe quand quelque chose a mal tourné.

La liste vit sur l'onglet **Exécutions** d'un workflow. Ouvre le workflow, clique sur **Exécutions**, et la table charge les exécutions les plus récentes. Chaque ligne se déplie en une vue JSON de l'exécution, de ses variables et du journal étape par étape.

## La vue liste

La liste montre une ligne par exécution, triée par heure de début. Les colonnes sont l'ID d'exécution, le badge de statut, l'heure de début (à la milliseconde près), la durée et la source de déclencheur. La barre d'outils au-dessus porte une boîte de recherche (matche un ID d'exécution), un filtre de statut, un filtre déclenché-par et un sélecteur de plage de dates.

| Colonne        | Type       | Requis | Description                                                                                                                            |
| -------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| ID d'exécution | Chaîne     | oui    | Identifiant stable pour l'exécution. Clique sur l'icône de copie pour la mettre dans le presse-papiers.                                |
| Statut         | Badge      | oui    | Un parmi `running`, `completed`, `failed`, `pending` ou `waiting_for_input` (quand un point d'approbation a mis l'exécution en pause). |
| Démarré à      | Horodatage | oui    | Heure murale du démarrage de l'exécution, dans le fuseau horaire de l'org.                                                             |
| Durée          | Nombre     | non    | Heure murale du démarrage à l'achèvement. Vide pour une exécution encore en cours.                                                     |
| Déclenché par  | Énum       | oui    | Un parmi `schedule`, `manual`, `webhook`, `event`, `api` ou `system`.                                                                  |

La pleine page charge par incréments — défile en bas et la page suivante se récupère. Le décompte approximatif de lignes dans la barre d'outils est une estimation bon marché ; le compte exact n'est pas tenu.

## La vue d'exécution dépliée

Déplie une ligne et Tale rend une vue JSON de l'exécution. Le niveau supérieur porte cinq champs : les métadonnées d'exécution (id, statut, heures de début et de fin, la source de déclencheur, l'erreur le cas échéant), le bloc de métadonnées au niveau de l'exécution venant du déclencheur, les variables d'entrée que l'exécution a reçues, le journal d'étapes et une chaîne d'erreur journal si le journal n'a pas pu charger.

Le journal est l'enregistrement par étape : chaque étape de l'exécution émet une entrée de journal avec ses entrées, ses sorties et son statut. Une étape échouée porte la chaîne d'erreur et la config d'étape qui l'a produite ; une étape de point d'approbation porte l'approbateur et la décision. Utilise le journal pour suivre l'exécution de bout en bout et repérer l'étape qui s'est mal comportée.

## Retry et relance

Les retries au niveau étape sont intégrés. Chaque type d'étape accepte une `retryPolicy` (tentatives max et backoff en millisecondes) dans la config d'étape ; les défaillances transitoires se rejouent automatiquement jusqu'au plafond configuré. Le défaut au niveau workflow s'applique quand une étape ne déclare pas sa propre politique. Ouvre le panneau de l'étape dans l'éditeur pour inspecter ou changer la politique.

Une exécution qui échoue au-delà de son budget retry reste dans le journal d'exécution comme `failed`. Pour relancer avec les mêmes entrées, ouvre le panneau de test dans la barre d'outils éditeur, colle le JSON d'entrée d'origine (copie-le depuis le bloc variables de l'exécution échouée) et clique sur **Exécuter**. La nouvelle exécution est une exécution fraîche avec son propre ID ; l'échec précédent reste dans le journal pour la piste d'audit.

## Une session de débogage mise en pratique

Une exécution de rapport quotidien a échoué à 08h01. Ouvre le workflow, passe à **Exécutions** et filtre par `Statut = failed` et `Date = aujourd'hui`. L'exécution défaillante est en haut. Déplie-la : le journal montre que la deuxième étape (un résumé d'agent) a erroré avec `request timed out`. Le bloc variables de l'étape porte le prompt que l'agent a reçu ; erreur et prompt ensemble pointent généralement la cause racine — trop de tokens, un document de connaissance manquant, un appel d'outil trop empressé. Corrige le problème sous-jacent, puis relance le workflow depuis le panneau de test avec la même entrée pour confirmer le correctif.

## Où ça s'inscrit

Les journaux d'exécution sont le reçu que chaque workflow laisse derrière lui ; ils sont comment tu sais ce qui a tourné, ce que ça a produit et où ça a cassé. Combine-les avec [métriques](/fr/platform/workflows/metrics) pour les mêmes informations agrégées sur des exécutions (taux de succès, durée p50/p95), avec [déclencheurs](/fr/platform/workflows/triggers) pour le coup d'envoi qui ouvre chaque exécution, et avec [journaux d'audit](/fr/platform/admin/governance/audit-logs) pour la piste org-large de qui a démarré quelle exécution.
