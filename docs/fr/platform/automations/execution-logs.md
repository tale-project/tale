---
title: Journaux d’exécution
description: L’historique d’exécution par workflow — chaque exécution avec son statut, sa chronologie et sa source de déclenchement, dépliable en un journal par étape. À lire quand une exécution a échoué ou s’est comportée bizarrement.
---

Les journaux d’exécution sont l’historique d’un seul workflow. Chaque fois qu’un déclencheur se lance, Tale ouvre un enregistrement d’exécution et y écrit au fil de l’exécution — statut, chronologie, l’entrée reçue et ce que chaque étape a consommé et produit. L’onglet **Exécutions** est la surface de débogage vers laquelle chaque autre page des automatisations pointe quand quelque chose a mal tourné.

<Frame caption="L’onglet Exécutions — une ligne par exécution ; les badges de statut rouges sont le point de départ d’une session de débogage.">

![L’onglet Exécutions d’une automatisation listant douze exécutions, chacune avec un ID d’exécution, un badge de statut Échouée, un horodatage de départ, une durée et une source de déclenchement par événement.](/images/platform/automation-executions.webp)

</Frame>

## La vue liste

Une ligne par exécution, la plus récente en premier. La barre d’outils porte **Rechercher par ID d'exécution**, un **Filtre** et un sélecteur de plage de dates.

| Colonne        | Description                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID d’exécution | Identifiant stable de l’exécution — l’icône de copie le met dans le presse-papiers.                                                                                                     |
| Statut         | **En attente**, **En cours**, **Terminée** ou **Échouée** — plus **En attente de saisie** quand une exécution est bloquée sur un humain, et **En pause** pendant un débogage pas à pas. |
| Démarrée le    | Heure de départ, montre en main, à la milliseconde.                                                                                                                                     |
| Durée          | Du départ à la fin ; vide tant que l’exécution est en cours.                                                                                                                            |
| Déclenchée par | Le chemin qui a démarré l’exécution — une planification, un webhook, un événement ou un test depuis l’éditeur.                                                                          |

## L’exécution dépliée

Déplie une ligne et l’enregistrement s’affiche en JSON : les métadonnées d’exécution (statut, chronologie, source de déclenchement et l’erreur s’il y en a une), les métadonnées portées par le déclencheur, les variables d’entrée et le **journal** — une entrée par étape exécutée avec ses entrées, ses sorties et son statut. Une étape échouée porte la chaîne d’erreur qui l’a tuée. Lis le journal de haut en bas et l’exécution se raconte à nouveau ; l’entrée dont le statut bascule est l’étape qui s’est mal comportée.

## Nouvelles tentatives et relances

Les échecs transitoires se retentent tout seuls. L’onglet **Configuration** du workflow fixe le défaut — **Nombre max de tentatives** et **Backoff (ms)** — et chaque étape peut le surcharger dans sa propre config.

<Frame caption="L’onglet Configuration — le budget de tentatives et le backoff dont chaque étape hérite sauf si elle les surcharge.">

![L’onglet Configuration d’une automatisation montrant des champs de nom et de description, un timeout de 600000 millisecondes, un nombre max de tentatives de 3, un backoff de 1000 millisecondes et un éditeur JSON de variables.](/images/platform/automation-configuration.webp)

</Frame>

Une exécution qui échoue au-delà de son budget de tentatives reste **Échouée** pour la piste d’audit ; pour réessayer, ouvre **Tester le workflow** dans l’éditeur, colle l’entrée copiée depuis le bloc de variables de l’exécution échouée et clique sur **Exécuter**. La relance est une exécution neuve avec son propre ID.

## Une session de débogage de bout en bout

Un rapport quotidien n’est pas arrivé. Ouvre le workflow, passe sur **Exécutions** et filtre sur les échecs du jour — l’exécution fautive est en haut. Déplie-la : le journal montre que l’étape de synthèse a échoué sur un timeout, et ses entrées portent le prompt reçu. Corrige la cause, relance depuis le panneau de test avec la même entrée, et regarde la nouvelle exécution se terminer avant de faire confiance à la planification de demain.

## Où cela s’inscrit

Les journaux d’exécution sont le reçu que chaque workflow laisse derrière lui. Associe-les aux [déclencheurs](/fr/platform/automations/triggers) pour le coup d’envoi qui a ouvert chaque enregistrement, et aux [journaux d’audit](/fr/platform/admin/governance/audit-logs) pour la trace à l’échelle de l’org de qui a changé quoi.
