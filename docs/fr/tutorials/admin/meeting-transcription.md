---
title: Rendre une transcription de réunion consultable
description: Importer une transcription vérifiée dans le bon projet, contrôler son indexation et préparer les imports récurrents.
---
Transforme une transcription exportée en source de projet que les membres peuvent interroger dans le chat. Commence par un fichier texte vérifié, puis contrôle son accès et son indexation avant d’automatiser la livraison. Tu dois pouvoir modifier le projet cible et être autorisé à partager ce texte avec ses membres.

Tale ne fournit ni connecteur Meetily dédié ni dossier de transcriptions surveillé. Exporte depuis ton outil de transcription, puis utilise l’import de documents ou l’API de Tale. Ce guide commence après la transcription ; il n’enregistre pas de réunion et ne configure pas cet outil.

## Préparer la transcription

Exporte du texte lisible, de préférence un fichier `.txt` pour le premier essai. Vérifie les noms, les locuteurs, les chiffres importants et les décisions avec l’enregistrement de la réunion. Une transcription automatique peut mal reconnaître les détails sur lesquels les lecteurs s’appuieront.

Choisis un nom identifiable, comme `2026-09-14-revue-projet.txt`. Indique aussi la date, le sujet et les participants dans le texte. Retire ce qui ne doit pas être partagé avec les membres du projet. Importer le texte n’exige pas d’importer l’audio.

## Choisir les lecteurs

Importe le texte dans l’onglet **Connaissances** du projet s’il lui appartient. Les droits du projet déterminent l’accès, et la recherche se fait depuis ses chats. Choisis **Connaissances > Documents** uniquement si le texte doit rejoindre les connaissances de l’organisation avec les restrictions d’équipe appropriées.

Vérifie le public prévu avant l’import. Un fichier de projet n’apparaît pas automatiquement dans la bibliothèque de l’organisation ni dans les chats d’un autre projet.

## Importer et contrôler

1. Ouvre le projet cible et sélectionne **Connaissances**.
2. Choisis le dossier, puis **Ajouter un fichier** pour importer la transcription.
3. Ouvre le fichier et vérifie son titre et son contenu.
4. Attends **Indexé** avant de tester la recherche. **En file d'attente** et **Indexation** indiquent que la préparation continue.

<Frame caption="La liste des fichiers du projet permet de vérifier la destination et l’état d’indexation.">

![L’onglet Connaissances du projet affiche les fichiers importés et leur état d’indexation.](/images/platform/project-knowledge-files.webp)

</Frame>

Pour **Échec**, consulte l’erreur et utilise **Réessayer l'indexation** après l’avoir corrigée. Pour **Non indexé**, choisis **Indexer maintenant** si l’action est proposée. Un échec persistant peut nécessiter un contrôle du stockage, de l’extraction du texte et du fournisseur d’embeddings par un administrateur. [Gérer les fichiers du projet](/fr/platform/projects/manage-files) explique les états et les limites.

## Vérifier la recherche dans le projet

Ouvre un chat du même projet. Pose une question précise dont tu as vérifié la réponse, par exemple : « Lors de la revue du 14 septembre, qui a accepté de préparer le prochain brouillon ? » Ouvre la source citée et compare la réponse au texte original. Un import terminé ne prouve pas à lui seul que la recherche fonctionne, et une réponse de l’assistant ne remplace pas cette vérification.

Pour les transcriptions sensibles, vérifie le choix des fournisseurs : l’indexation peut envoyer du texte à un fournisseur d’embeddings, puis la réponse peut transmettre des passages au modèle de chat. Une transcription locale ne maintient pas automatiquement ces étapes sur ton réseau. Demande à l’administrateur ou à l’opérateur de contrôler les deux parcours.

## Préparer les imports récurrents

Pour des réunions occasionnelles, conserve la procédure d’import. Pour des livraisons régulières, un développeur peut utiliser l’[API d’import de projet](/fr/develop/api-reference) ou un [webhook d’automatisation](/fr/tutorials/developer/trigger-automation-via-webhook) associé à une automatisation d’import explicitement créée. Le webhook lance cette automatisation ; il n’est pas, à lui seul, un endpoint de stockage des transcriptions.

L’intégration doit choisir le projet, éviter les doublons, demander l’indexation et suivre son résultat. Les fichiers de projet importés par REST ne sont pas indexés par défaut ; `skipRagIndexing: false` demande l’indexation lors du rattachement. Réutiliser un nom de fichier ne crée pas de révision. Pour conserver un historique approuvé, utilise la procédure de remplacement prévue.
