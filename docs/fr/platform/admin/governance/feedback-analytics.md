---
title: Analyse des retours
description: Pouces haut et bas agrégés sur les réponses d'assistant et verdicts d'arène, ventilés par assistant et par modèle.
---

Analyse des retours est le dashboard qui transforme les pouces par message et les verdicts d'arène en courbes de tendance. Les membres laissent le retour inline dans le chat ; cette page l'agrège par assistant, par modèle et dans le temps, pour que la régression du changement de voix de la semaine dernière soit visible comme un chiffre, pas comme un pressentiment. Les Administrateurs et Propriétaires lisent cette page quand un changement de modèle ressemble à une dégradation, quand un assistant performe moins que les autres, ou quand la direction veut la posture qualité approximative de chaque assistant dans l'organisation.

## Un drill-down mis en pratique

Ouvre **Paramètres > Métriques > Retours** et la vue par défaut est le sentiment org-wide sur les 7 derniers jours — élargis la période quand la fenêtre est calme. **Top assistants par retour** montre le ratio d'utilité par assistant avec son volume, pour que les assistants réellement utilisés ressortent ; filtre sur l'un d'eux et la courbe de sentiment et les commentaires récents suivent. **Top modèles par retour** est la même donnée découpée selon le modèle qui a produit chaque réponse notée.

## Les deux signaux

**Retour pouces** est le signal par message — un pouce en haut ou un pouce en bas sur une réponse d'assistant. Le pouce porte un commentaire libre optionnel ; le commentaire est par ligne et n'entre jamais dans le ratio. Les membres peuvent changer leur pouce ou le retirer entièrement ; les chiffres reflètent le dernier état.

**Verdicts d'arène** est le signal par comparaison — quand un membre fait tourner deux modèles côte à côte en [mode arène](/fr/platform/chat/arena-mode), le verdict atterrit ici. Le résumé compte les votes décisifs, les égalités et les « les deux mauvais » ; **Top duels de modèles** garde le score par paire, parce qu'un « A gagne » n'a de sens que contre le modèle battu.

## Ventilations

Le dashboard découpe selon trois dimensions :

- **Assistant** — chaque assistant avec des réponses notées a sa propre ligne avec les comptes utile et pas utile et le sentiment qui en découle.
- **Modèle** — chaque modèle qui a produit une réponse notée contribue ; les paires d'arène restent tête à tête dans le tableau des duels.
- **Temps** — la courbe du sentiment au fil du temps suit la fenêtre choisie, d'un jour à 90 jours. Au-delà de 50 000 entrées dans une fenêtre, la page montre des résultats partiels et demande de resserrer.

## Commentaires libres

Les commentaires apparaissent dans la liste **Retours récents** sous les chiffres agrégés. Filtre avec **Commentaires uniquement** pour masquer les pouces nus, et par type pour séparer les pouces de chat des verdicts d'arène. Les commentaires sont soumis à la même politique de rétention que les conversations auxquelles ils appartiennent ; si un thread est purgé ou mis à la corbeille, ses commentaires partent avec.

## Où cela s'inscrit

Analyse des retours est le pouls de chaque assistant dans l'organisation — l'endroit où une régression de voix ou de comportement de modèle apparaît avant que quelqu'un la signale. La page compagnon est [analyse d'utilisation](/fr/platform/admin/governance/usage-analytics) — les mêmes assistants et modèles, découpés par dépense et volume de tokens au lieu de qualité.
