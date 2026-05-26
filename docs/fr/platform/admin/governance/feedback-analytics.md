---
title: Analyse des retours
description: Pouces haut et bas agrégés sur les messages d'agent et notations de chat, ventilés par agent et par modèle. Les Administrateurs et Propriétaires lisent ceci quand une régression d'agent a besoin d'un chiffre derrière.
---

Analyse des retours est le dashboard qui transforme les pouces par message et les notations par chat en courbes de tendance. Les membres laissent le retour inline dans le chat ; cette page l'agrège par agent, par modèle et dans le temps, pour que la régression du changement de voix de la semaine dernière soit visible comme un chiffre, pas comme un pressentiment. Les Administrateurs et Propriétaires lisent cette page quand un changement de modèle ressemble à une dégradation, quand un agent performe moins que les autres, ou quand la direction veut la posture qualité approximative de chaque agent dans l'organisation.

## Un drill-down mis en pratique

Ouvre **Paramètres > Gouvernance > Retours** et la vue par défaut est le ratio org-wide sur les 30 derniers jours. Bascule la ventilation sur **Par agent** pour voir le ratio par agent — trie par volume de retours pour trouver les agents que les membres utilisent vraiment, puis clique dans l'un pour voir son historique de modèles à côté du même ratio dans le temps. La vue split-par-modèle est la même donnée découpée selon le modèle qui a produit chaque réponse notée.

## Les deux signaux

**Retour pouces** est le signal par message — un pouce en haut ou un pouce en bas sur une réponse d'agent. Le pouce porte un commentaire libre optionnel ; le commentaire est par ligne et n'entre jamais dans le ratio. Les membres peuvent laisser les deux, modifier l'un ou retirer entièrement ; la timeline reflète le dernier état.

**Notations de chat** est le signal par conversation — la notation d'une à cinq étoiles qui apparaît à la fin d'une conversation. Les notations portent aussi un commentaire optionnel. Les notations de chat sont plus grossières que les pouces et utiles pour suivre l'ambiance au niveau agent sur de nombreux tours, là où les pouces individuels seraient du bruit.

## Ventilations

Le dashboard découpe selon trois dimensions :

- **Agent** — chaque agent de l'organisation a sa propre ligne avec ratio, volume et tendance.
- **Modèle** — chaque modèle qui a produit une réponse notée contribue ; utile quand tu compares un primaire à son repli.
- **Temps** — la tendance est quotidienne pour les 30 derniers jours et hebdomadaire pour les fenêtres plus longues.

## Commentaires libres

Les commentaires apparaissent sous les chiffres agrégés en liste. Trie par récence ou par sentiment ; clique pour rejoindre la conversation en contexte et voir ce à quoi la réponse notée répondait. Les commentaires sont soumis à la même politique de rétention que les conversations auxquelles ils appartiennent ; si un thread est purgé ou mis à la corbeille, ses commentaires partent avec.

## Où cela s'inscrit

Analyse des retours est le pouls de chaque agent dans l'organisation — l'endroit où une régression de voix ou de comportement de modèle apparaît avant que quelqu'un la signale. La page compagnon est [analyse d'utilisation](/fr/platform/admin/governance/usage-analytics) — les mêmes agents et modèles, découpés par dépense et volume de tokens au lieu de qualité.
