---
title: Nouveautés
description: Le visualisateur de changelog in-app — notes de version pour la version Tale que ton instance fait tourner, rafraîchies à chaque mise à niveau et pilotées par badge afin que les utilisateurs voient les changements sans quitter le produit.
---

La boîte **Nouveautés** est le visualisateur de changelog in-app. Après l'arrivée d'une version — que ce soit l'édition Cloud qui a roulé automatiquement ou `tale deploy` qui a terminé sur une instance auto-hébergée — un petit badge apparaît à côté de l'avatar de chaque utilisateur et pointe vers les nouvelles entrées. Ouvrir la boîte affiche les notes de version pour la version sur laquelle se trouve l'instance, plus chaque version antérieure depuis le dernier marquage comme lu par l'utilisateur. Le public, c'est tout le monde dans le produit : les Membres voient ce qui a changé dans leur interface, les Admins lisent les mêmes notes pour savoir quoi communiquer à l'équipe.

Cette page est pour les Admins et les Développeurs qui doivent comprendre comment la boîte se rend, d'où vient son contenu et ce qui entre ou sort du périmètre. L'Admin ne configure pas la boîte ; badge et contenu sont entièrement pilotés par les versions publiées.

## Comment la boîte atteint le lecteur

Tale affiche le badge au moment où une version avec des changements visibles aux utilisateurs est détectée. Cliquer le badge ouvre la boîte. Chaque entrée porte un numéro de version, une date de sortie et un corps Markdown décrivant ce qui a changé dans cette version.

Le badge s'efface quand la boîte est reconnue — pas à la simple ouverture. Un utilisateur qui ferme la boîte sans dérouler chaque nouvelle entrée voit toujours le badge à la session suivante, de sorte que l'indicateur se comporte comme un compteur de non-lus plutôt qu'une notification ponctuelle.

Quand une instance saute plusieurs versions en une seule mise à niveau — par exemple `v1.4` à `v1.6` parce que `v1.5` a été sautée — la boîte liste chaque version intermédiaire dans l'ordre chronologique. Rien entre les deux extrémités ne disparaît à cause du saut.

## D'où vient le contenu

Les notes de version sont publiées au format canonique décrit dans [Format des notes de version](/fr/self-hosted/operate/release-notes/format) sur le dépôt GitHub du projet. La plateforme va chercher les notes de chaque version visible pour l'édition courante à l'installation et à la mise à niveau, les met en cache localement, et rend les sections par version via le même renderer Markdown que le reste de la doc.

Le chemin de rendu est court :

1. CI publie les notes à chaque tag de release.
2. La plateforme tire le Markdown canonique à l'installation et à la mise à niveau.
3. La boîte rend chaque section par version, la plus récente en premier.
4. Le compteur du badge s'incrémente dès que les notes d'une nouvelle version arrivent.

Si une instance auto-hébergée est hors-ligne ou ne peut pas atteindre GitHub, la mise à niveau se termine quand même — la boîte se replie sur les notes embarquées dans l'artefact de release plutôt que bloquer sur la requête réseau.

## Ce qui est dans le périmètre, ce qui ne l'est pas

Le changelog in-app reflète les notes de version GitHub canoniques. Le contenu est identique ; seule la surface diffère. Les changements couverts sont ceux qu'un utilisateur remarquerait : nouvelles fonctionnalités, ruptures de compatibilité, correctifs que le lecteur peut vérifier, et notes de migration pour les mises à niveau qui exigent une action de l'opérateur.

Hors périmètre, par conception :

- **Changements purement infrastructure** — bumps de dépendances, refactorings internes, ajustements CI. Ça vit dans l'historique git.
- **Notes opérationnelles spécifiques au Cloud** — incidents et maintenance planifiée vont sur la [page de statut](/fr/develop/status-page), pas dans le changelog.
- **Annonces de roadmap** — le site marketing porte ça ; le changelog ne décrit que les versions livrées.

Pour les détails côté opérateur d'une mise à niveau — les flags CLI exacts, les réserves de rétrogradation, les variables d'env dépréciées — [Format des notes de version](/fr/self-hosted/operate/release-notes/format) est la source faisant autorité.

## Où cela s'insère

Le changelog est la moitié côté utilisateur de chaque release. Les opérateurs lisent les notes de version GitHub avant de lancer `tale deploy` pour planifier les actions ; tout le monde dans le produit lit la boîte in-app après l'arrivée de la mise à niveau pour apprendre ce qui a changé. Ensemble, les deux surfaces couvrent les deux bouts de chaque release.

Pour l'état en direct de l'édition Cloud — incidents, maintenance, statut par région — [Page de statut](/fr/develop/status-page) est la surface à lire à la place. Pour le catalogue historique de notes de version sur chaque version, la référence [Format des notes de version](/fr/self-hosted/operate/release-notes/format) est l'endroit où vivent les entrées canoniques.
