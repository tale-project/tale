---
title: Gérer les fichiers d'un Projet
description: Téléverser, remplacer, supprimer, et les limites de taille par Projet — et comment les fichiers de Projet apparaissent dans les chats du Projet.
---

L'onglet **Files** d'un Projet est la zone de fichiers partagée que chaque chat du Projet peut atteindre. Téléverse un fichier une fois et chaque chat du Projet — et chaque agent qui y tourne — peut le lire sans nouveau téléversement. Cette page couvre le mécanisme d'upload et les limites.

L'onglet Files n'est pas une base de connaissances au sens de [Knowledge](/fr/platform/knowledge/documents). C'est une liste plate de fichiers scopée à un Projet ; supprimer le Projet supprime les fichiers. Pour du matériel de référence à l'échelle de l'organisation, utilise Knowledge et lie-le à des agents.

## Un téléversement déroulé

Ouvre le Projet, clique **Files**, et glisse un dossier sur la zone de dépôt. Tale téléverse chaque fichier individuellement ; la ligne montre une barre de progression par fichier et passe à **Uploaded** une fois le fichier arrivé. Le même téléversement est désormais accessible depuis n'importe quel chat que le Projet possède : tape `@` dans le composer et le fichier apparaît dans le sélecteur, ou envoie un message qui référence le sujet et l'agent le récupère.

## Remplacer et supprimer

Remplacer un fichier téléverse une nouvelle copie sous le même nom ; l'ancienne version passe dans l'historique de versions du Projet. Les citations des chats antérieurs continuent de pointer vers la version qui était active quand le chat l'a référencée. Supprimer un fichier le retire du sélecteur immédiatement ; les chats existants gardent leurs citations mais le fichier sous-jacent passe dans la [Corbeille](/fr/platform/admin/governance/trash) avec le reste de la cohorte de rétention du Projet.

## Limites de taille

Les limites par fichier et par Projet sont fixées par l'organisation sous [Politiques et limites](/fr/platform/admin/governance/policies-and-limits). Atteindre une limite par fichier fait échouer le téléversement avec un toast ; atteindre une limite par Projet fait échouer le téléversement avec un autre toast qui nomme la politique. Les membres qui atteignent une limite ne peuvent pas l'élever eux-mêmes — un Admin ajuste la politique, ou le propriétaire du Projet supprime des fichiers plus anciens.

## Apparition dans les chats

Un chat démarré à l'intérieur d'un Projet a automatiquement accès à chaque fichier de l'onglet Files du Projet. L'outil de récupération de l'agent voit les fichiers du Projet à côté de toute source de Knowledge liée à l'agent. Les citations issues de fichiers de Projet sont scopées au chat qui les a produites — partager un chat hors du Projet préserve les citations mais le visiteur ne peut pas cliquer vers la source à moins d'être lui aussi dans le Projet.

## Où ça s'inscrit

Gérer les fichiers est la page opérationnelle pour l'onglet Files — le cadrage conceptuel est sur [Concepts de projet](/fr/platform/projects/concepts), et l'équivalent lié à l'agent à l'échelle de l'organisation entière est [Documents](/fr/platform/knowledge/documents). Si tu te surprends à téléverser les mêmes fichiers dans plusieurs Projets, c'est le signal pour les déplacer dans Knowledge et lier un agent à la place.
