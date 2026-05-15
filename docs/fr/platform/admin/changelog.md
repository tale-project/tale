---
title: Nouveautés
description: Le visualisateur de changelog in-app — notes de version pour la version Tale que ton instance fait tourner, tenue à jour au fil des upgrades.
---

Le dialogue **Nouveautés** est le visualisateur de changelog in-app. Après un upgrade — que l'édition Cloud soit passée en avant ou que `tale deploy` ait terminé sur ton instance auto-hébergée — un petit badge apparaît dans la navigation, pointant vers les nouvelles entrées ; ouvrir le dialogue montre les notes de version pour la version sur laquelle tu es, plus chaque version précédente depuis ta dernière visite. Le public visé : tout le monde dans le produit. Les Membres voient ce qui a changé dans leur UI, les Admins lisent les mêmes notes pour savoir ce qu'il faut briefer à l'équipe.

Cette page s'adresse aux Admins et Développeurs qui veulent comprendre comment le dialogue s'affiche, d'où vient son contenu et ce qui est couvert ou exclu.

## Comment le dialogue atteint le lecteur

Un petit badge apparaît à côté de l'avatar de l'utilisateur après une release qui introduit des changements visibles. Clique dessus pour ouvrir le dialogue **Nouveautés**. Le dialogue liste chaque version publiée depuis la dernière fois où l'utilisateur a marqué le changelog comme lu ; chaque entrée a un numéro de version, une date de release et un corps Markdown décrivant ce qui a changé.

Le badge s'efface au moment où le dialogue est accusé réception — pas seulement quand il est ouvert. Fermer le dialogue sans dérouler chaque nouvelle entrée laisse le badge en place jusqu'à la session suivante.

## D'où vient le contenu

Les notes de version sont publiées dans le [format de notes de version](/fr/self-hosted/operate/release-notes/format) canonique sur le dépôt GitHub du projet. La plateforme récupère les notes pour chaque version visible à l'édition en cours et les affiche dans le dialogue. Les upgrades cross-version — disons un saut de `v1.4` à `v1.6` parce que `v1.5` a été sautée — montrent les notes de chaque version intermédiaire dans l'ordre chronologique, donc aucun changement entre les deux versions n'est caché par le saut.

Le chemin de rendu :

1. La CI publie les notes à chaque release taggée.
2. La plateforme récupère la source Markdown canonique au moment de l'installation/upgrade.
3. Le dialogue rend les sections Markdown par version dans l'ordre chronologique.
4. Le compteur du badge s'incrémente quand les notes d'une nouvelle version atterrissent.

## Ce qui est dans le périmètre, ce qui ne l'est pas

Le changelog in-app reflète les notes de version GitHub canoniques — même contenu, juste rendu à l'intérieur du produit. Il couvre les changements visibles : nouvelles fonctionnalités, changements cassants, corrections de bugs que le lecteur remarquerait, et notes de migration pour les upgrades qui demandent une action côté exploitant.

Il ne couvre **pas** : les changements infrastructure uniquement (bumps de dépendances, refactos internes), les notes opérationnelles spécifiques au Cloud (qui vont dans des status posts), ni les annonces de roadmap (qui vivent sur le site marketing). Pour le détail côté exploitant d'un upgrade — drapeaux CLI exacts, mises en garde de downgrade, variables d'environnement dépréciées — la [référence du format des notes de version](/fr/self-hosted/operate/release-notes/format) est la source qui fait autorité.

## Où ça s'inscrit

Le changelog est la couche de communication utilisateur pour les upgrades. Les exploitants lisent les notes de version GitHub avant de lancer `tale deploy` ; toute personne dans le produit lit le dialogue in-app après l'upgrade. Ensemble, ils couvrent les deux bouts de la release : l'exploitant obtient les actions à mener, l'utilisateur l'explication. Pour le statut public de l'édition Cloud (incidents, maintenance planifiée), la [Page de statut](/fr/develop/status-page) est la surface.
