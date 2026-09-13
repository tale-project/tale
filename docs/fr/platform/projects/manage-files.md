---
title: Gérer les fichiers du projet
description: L’onglet Connaissances du projet tient les fichiers où chaque chat du projet peut puiser — dossiers, téléversement, statut d’indexation, et comment les fichiers du projet restent scopés au projet.
---

L’onglet **Connaissances** d’un projet est la zone de fichiers partagée que chaque chat du projet peut atteindre. Téléverse un fichier une fois et chaque chat du projet — et chaque agent qui y tourne — peut le lire sans nouveau téléversement. Cette page couvre l’arborescence de dossiers, le mécanisme de téléversement, l’épinglage et les limites.

L’onglet Connaissances n’est pas la base de connaissances de l’organisation au sens de [Documents](/fr/platform/knowledge/documents). Ses fichiers sont scopés à un projet et n’apparaissent jamais dans la bibliothèque de l’organisation ni via WebDAV ; supprimer le projet supprime les fichiers. Pour du matériel de référence à l’échelle de l’organisation, utilise [Documents](/fr/platform/knowledge/documents) et lie-les à des agents. Les deux endroits ont deux leviers d’accès : qui voit un document du hub, ses tags d’équipe le décident ; qui voit un fichier de projet, seul l’accès au projet le décide — un projet à l’échelle de l’organisation veut dire chaque membre, un projet d’équipe ses équipes propriétaire et partagées, et les propriétaires et les admins voient chaque projet. Un fichier de projet ne porte jamais de tag d’équipe, et un document vit à un seul des deux endroits.

<Frame caption="L’onglet Connaissances — l’arborescence de fichiers du projet ; chaque fichier reste borné à ce projet et indexé pour la recherche.">

![L’onglet Connaissances du projet Website relaunch montrant deux fichiers indexés dans l’arborescence, un bouton Nouveau dossier et la zone de dépôt Ajouter un fichier.](/images/platform/project-knowledge-files.webp)

</Frame>

## Dossiers

Les fichiers du projet vivent dans une arborescence de dossiers. **Nouveau dossier** en crée un à la racine ; l’icône dossier-plus sur une ligne de dossier crée un sous-dossier. Clique un dossier pour le sélectionner — la zone de dépôt passe à _Ajouter un fichier à « … »_ et les téléversements y atterrissent. **Ajouter un dossier** téléverse un dossier entier depuis le disque : choisis un répertoire, et ses fichiers atterrissent avec la structure de sous-dossiers recréée sous le dossier sélectionné — les fichiers que le portail refuse sont ignorés et signalés, et une sélection est plafonnée à 200 fichiers / 200 Mo. Supprimer un dossier supprime tout son contenu, y compris les entrées des fichiers dans l’index de récupération ; la confirmation le dit avant que quoi que ce soit n’arrive. Les dossiers ici sont scopés au projet : un dossier homonyme dans la bibliothèque de l’organisation est un dossier différent.

## Un téléversement déroulé

Ouvre le projet, clique **Connaissances**, sélectionne le dossier cible (ou aucun pour la racine), et glisse des fichiers sur la zone de dépôt. La ligne apparaît dans l’arborescence et passe à **Indexé** une fois que la récupération l’a intégrée. Le même téléversement est désormais accessible depuis n’importe quel chat que le projet possède : envoie un message qui nomme le sujet et l’assistant le récupère, en chargeant le texte complet quand un extrait ne suffit pas. Un fichier arrivé par l’[API REST](/fr/develop/api-reference#refleter-un-systeme-externe-dans-un-projet) figure aussi dans la liste, mais affiche **Non indexé** : une recherche ne le trouve pas tant que tu n’as pas cliqué sur **Indexer maintenant** sur sa ligne — l’assistant lit tout de même un fichier en texte brut à la demande quand tu le nommes.

## Remplacer et supprimer

Remplacer un fichier téléverse une nouvelle copie sous le même nom ; l’ancienne version passe dans l’historique de versions du projet. Les citations des chats antérieurs continuent de pointer vers la version qui était active quand le chat l’a référencée. Supprimer un fichier le retire du sélecteur immédiatement ; les chats existants gardent leurs citations, mais le fichier sous-jacent passe dans la [Corbeille](/fr/platform/admin/governance/trash) avec le reste de la cohorte de rétention du projet.

## Verrouiller un fichier derrière une relecture

Quand l’approbation doit rester liée au fichier exact que le relecteur a vu — une SOP, un plan de validation —, ouvre le menu de la ligne du fichier et clique **Marquer comme document maîtrisé**. La ligne porte alors `v1 · Brouillon` et suit le même cycle de vie qu’un document maîtrisé dans la bibliothèque de l’organisation : **Soumettre à la relecture** fige le fichier pour un relecteur nommé, l’approbation rend la version immuable, et **Nouvelle révision** ouvre le brouillon suivant. Le cycle de vie complet — remplacement du fichier d’un brouillon compris — est sur [Documents](/fr/platform/knowledge/documents#reviser-un-document-maitrise). La portée ne change pas : un fichier de projet maîtrisé reste un fichier de projet, visible seulement dans le projet.

## Limites de taille

Les limites par fichier et par projet sont fixées par l’organisation sous [Politiques et limites](/fr/platform/admin/governance/policies-and-limits). Atteindre une limite par fichier fait échouer le téléversement avec un toast ; atteindre une limite par projet le fait échouer avec un autre toast qui nomme la politique. Les membres qui atteignent une limite ne peuvent pas l’élever eux-mêmes — un Admin ajuste la politique, ou le propriétaire du projet supprime des fichiers plus anciens.

## Apparition dans les chats

Un chat démarré à l’intérieur d’un projet a automatiquement accès à chaque fichier de l’onglet Connaissances du projet. Les outils de l’assistant voient les fichiers de ce projet à côté du hub de connaissances de l’organisation tel que tu le vois — et rien des autres projets : la frontière est posée par le serveur pour chaque chat du projet, pas par ce que l’assistant décide de chercher. Demander les documents du projet les liste à côté de ceux du hub, chacun marqué de l’endroit où il vit et de son état d’indexation ; un fichier non indexé reste lisible à la demande quand il est en texte brut. Le chat de l’organisation, hors de tout projet, n’atteint que le hub — les fichiers d’un projet se lisent depuis le chat du projet lui-même. Les citations issues de fichiers du projet sont scopées au chat qui les a produites — partager ce chat hors du projet préserve les citations, mais le visiteur ne peut pas cliquer vers la source à moins d’être lui aussi dans le projet.

Il n’y a pas de sélecteur `@` dans le composeur de cette version — un message nomme le sujet, la récupération trouve le fichier, et l’assistant charge le texte complet avec son outil de chargement quand il lui faut plus qu’un extrait. Un agent de projet qui travaille une tâche du tableau reçoit ses fichiers autrement : les pièces jointes de la tâche sont recopiées en lecture seule dans sa sandbox sous `/agent/inputs/<task>/attachments/`, de sorte qu’un harness de code ouvre les vrais octets plutôt qu’un extrait de recherche — [Harnesses](/fr/platform/agents/harnesses) couvre cette voie.

## Où cela s’inscrit

Gérer les fichiers est la page opérationnelle de l’onglet Connaissances — le cadrage conceptuel est sur [Concepts de projet](/fr/platform/projects/concepts), et l’équivalent lié à l’agent à l’échelle de l’organisation entière est [Documents](/fr/platform/knowledge/documents). Si tu te surprends à téléverser les mêmes fichiers dans plusieurs projets, c’est le signal pour les déplacer dans [Documents](/fr/platform/knowledge/documents) et lier un agent à la place.
