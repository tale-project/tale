---
title: Gérer les fichiers du projet
description: L’onglet Connaissances du projet tient les fichiers où chaque chat du projet peut puiser — dossiers, téléversement, statut d’indexation, épinglage, et comment les fichiers du projet restent scopés au projet.
---

L’onglet **Connaissances** d’un projet est la zone de fichiers partagée que chaque chat du projet peut atteindre. Téléverse un fichier une fois et chaque chat du projet — et chaque agent qui y tourne — peut le lire sans nouveau téléversement. Cette page couvre l’arborescence de dossiers, le mécanisme de téléversement, l’épinglage et les limites.

L’onglet Connaissances n’est pas la base de connaissances de l’organisation au sens de [Documents](/fr/platform/knowledge/documents). Ses fichiers sont scopés à un projet et n’apparaissent jamais dans la bibliothèque de l’organisation, dans les sélecteurs `@` hors du projet, ni via WebDAV ; supprimer le projet supprime les fichiers. Pour du matériel de référence à l’échelle de l’organisation, utilise [Documents](/fr/platform/knowledge/documents) et lie-les à des agents.

<Frame caption="L’onglet Connaissances — l’arborescence de fichiers du projet ; chaque fichier reste borné à ce projet et indexé pour la recherche.">

![L’onglet Connaissances du projet Website relaunch montrant deux fichiers indexés dans l’arborescence, un bouton Nouveau dossier et la zone de dépôt Ajouter un fichier.](/images/platform/project-knowledge-files.webp)

</Frame>

## Dossiers

Les fichiers du projet vivent dans une arborescence de dossiers. **Nouveau dossier** en crée un à la racine ; l’icône dossier-plus sur une ligne de dossier crée un sous-dossier. Clique un dossier pour le sélectionner — la zone de dépôt passe à _Ajouter un fichier à « … »_ et les téléversements y atterrissent. Supprimer un dossier supprime tout son contenu, y compris les entrées des fichiers dans l’index de récupération ; la confirmation le dit avant que quoi que ce soit n’arrive. Les dossiers ici sont scopés au projet : un dossier homonyme dans la bibliothèque de l’organisation est un dossier différent.

## Un téléversement déroulé

Ouvre le projet, clique **Connaissances**, sélectionne le dossier cible (ou aucun pour la racine), et glisse des fichiers sur la zone de dépôt. La ligne apparaît dans l’arborescence et passe à **Indexed** une fois que la récupération l’a intégrée. Le même téléversement est désormais accessible depuis n’importe quel chat que le projet possède : envoie un message qui référence le sujet et l’agent le récupère, ou tape `@` dans le chat et épingle le fichier — ou un dossier entier — au tour.

## Remplacer et supprimer

Remplacer un fichier téléverse une nouvelle copie sous le même nom ; l’ancienne version passe dans l’historique de versions du projet. Les citations des chats antérieurs continuent de pointer vers la version qui était active quand le chat l’a référencée. Supprimer un fichier le retire du sélecteur immédiatement ; les chats existants gardent leurs citations, mais le fichier sous-jacent passe dans la [Corbeille](/fr/platform/admin/governance/trash) avec le reste de la cohorte de rétention du projet.

## Limites de taille

Les limites par fichier et par projet sont fixées par l’organisation sous [Politiques et limites](/fr/platform/admin/governance/policies-and-limits). Atteindre une limite par fichier fait échouer le téléversement avec un toast ; atteindre une limite par projet le fait échouer avec un autre toast qui nomme la politique. Les membres qui atteignent une limite ne peuvent pas l’élever eux-mêmes — un Admin ajuste la politique, ou le propriétaire du projet supprime des fichiers plus anciens.

## Apparition dans les chats

Un chat démarré à l’intérieur d’un projet a automatiquement accès à chaque fichier de l’onglet Connaissances du projet. L’outil de récupération de l’agent voit les fichiers du projet à côté de toute source de Connaissances liée à l’agent. Les citations issues de fichiers du projet sont scopées au chat qui les a produites — partager ce chat hors du projet préserve les citations, mais le visiteur ne peut pas cliquer vers la source à moins d’être lui aussi dans le projet.

Épingler avec `@` resserre un seul tour : `@fichier` épingle un fichier, `@dossier` épingle un dossier et tout ce qu’il contient (le sélecteur propose les dossiers du projet dans les chats de projet, et les dossiers de l’organisation partout). Les fichiers épinglés sont aussi livrés dans la sandbox de l’agent sous `/user/uploads` — les agents sandbox comme Claude Code ouvrent donc les vrais octets au lieu de ne citer que des extraits de récupération.

## Où cela s’inscrit

Gérer les fichiers est la page opérationnelle de l’onglet Connaissances — le cadrage conceptuel est sur [Concepts de projet](/fr/platform/projects/concepts), et l’équivalent lié à l’agent à l’échelle de l’organisation entière est [Documents](/fr/platform/knowledge/documents). Si tu te surprends à téléverser les mêmes fichiers dans plusieurs projets, c’est le signal pour les déplacer dans [Documents](/fr/platform/knowledge/documents) et lier un agent à la place.
