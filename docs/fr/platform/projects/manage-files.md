---
title: Gérer les fichiers d'un Projet
description: Téléverser, remplacer, supprimer, et les limites de taille par Projet — et comment les fichiers de Projet apparaissent dans les chats du Projet.
---

L'onglet **Files** d'un Projet est la zone de fichiers partagée que chaque chat du Projet peut atteindre. Téléverse un fichier une fois et chaque chat du Projet — et chaque agent qui y tourne — peut le lire sans nouveau téléversement. Cette page couvre l'arborescence de dossiers, le mécanisme d'upload et les limites.

L'onglet Files n'est pas une base de connaissances au sens de [Knowledge](/fr/platform/knowledge/documents). Ses fichiers sont scopés à un Projet et n'apparaissent jamais dans la bibliothèque de l'organisation, dans les sélecteurs `@` hors du Projet, ni via WebDAV ; supprimer le Projet supprime les fichiers. Pour du matériel de référence à l'échelle de l'organisation, utilise Knowledge et lie-le à des agents.

## Dossiers

Les fichiers de Projet vivent dans une arborescence de dossiers. **Nouveau dossier** en crée un à la racine ; l'icône dossier-plus sur une ligne de dossier crée un sous-dossier. Clique un dossier pour le sélectionner — la zone de dépôt passe à _Ajouter un fichier à « … »_ et les téléversements y atterrissent. Supprimer un dossier supprime tout son contenu, y compris les entrées des fichiers dans l'index de connaissances ; la confirmation le dit avant que quoi que ce soit n'arrive. Les dossiers ici sont scopés au Projet : un dossier homonyme dans la bibliothèque Knowledge de l'organisation est un dossier différent.

## Un téléversement déroulé

Ouvre le Projet, clique **Knowledge**, sélectionne le dossier cible (ou aucun pour la racine), et glisse des fichiers sur la zone de dépôt. La ligne apparaît dans l'arborescence et passe à **Indexed** une fois que la récupération l'a intégrée. Le même téléversement est désormais accessible depuis n'importe quel chat que le Projet possède : envoie un message qui référence le sujet et l'agent le récupère, ou tape `@` dans le composer et épingle le fichier — ou un dossier entier — au tour.

## Remplacer et supprimer

Remplacer un fichier téléverse une nouvelle copie sous le même nom ; l'ancienne version passe dans l'historique de versions du Projet. Les citations des chats antérieurs continuent de pointer vers la version qui était active quand le chat l'a référencée. Supprimer un fichier le retire du sélecteur immédiatement ; les chats existants gardent leurs citations mais le fichier sous-jacent passe dans la [Corbeille](/fr/platform/admin/governance/trash) avec le reste de la cohorte de rétention du Projet.

## Limites de taille

Les limites par fichier et par Projet sont fixées par l'organisation sous [Politiques et limites](/fr/platform/admin/governance/policies-and-limits). Atteindre une limite par fichier fait échouer le téléversement avec un toast ; atteindre une limite par Projet fait échouer le téléversement avec un autre toast qui nomme la politique. Les membres qui atteignent une limite ne peuvent pas l'élever eux-mêmes — un Admin ajuste la politique, ou le propriétaire du Projet supprime des fichiers plus anciens.

## Apparition dans les chats

Un chat démarré à l'intérieur d'un Projet a automatiquement accès à chaque fichier de l'onglet Files du Projet. L'outil de récupération de l'agent voit les fichiers du Projet à côté de toute source de Knowledge liée à l'agent. Les citations issues de fichiers de Projet sont scopées au chat qui les a produites — partager un chat hors du Projet préserve les citations mais le visiteur ne peut pas cliquer vers la source à moins d'être lui aussi dans le Projet.

Épingler avec `@` resserre un seul tour : `@fichier` épingle un fichier, `@dossier` épingle un dossier et tout ce qu'il contient (le sélecteur propose les dossiers du Projet dans les chats de Projet, et les dossiers Knowledge de l'organisation partout). Les fichiers épinglés sont aussi livrés dans la sandbox de l'agent sous `/user/uploads` — les agents de code comme Claude Code ouvrent donc les vrais octets au lieu de ne citer que des extraits de récupération.

## Où ça s'inscrit

Gérer les fichiers est la page opérationnelle pour l'onglet Files — le cadrage conceptuel est sur [Concepts de projet](/fr/platform/projects/concepts), et l'équivalent lié à l'agent à l'échelle de l'organisation entière est [Documents](/fr/platform/knowledge/documents). Si tu te surprends à téléverser les mêmes fichiers dans plusieurs Projets, c'est le signal pour les déplacer dans Knowledge et lier un agent à la place.
