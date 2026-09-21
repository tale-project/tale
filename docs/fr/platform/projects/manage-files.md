---
title: Gérer les fichiers d’un projet
description: Ajoute et classe les fichiers, vérifie leur indexation et distingue la suppression du déplacement vers les connaissances partagées.
---

L’onglet **Connaissances** du projet contient les fichiers consultables par ses chats. Ajoute une référence une fois pour la réutiliser dans plusieurs conversations du projet. Tu dois pouvoir modifier le projet pour ajouter, organiser ou retirer ses fichiers.

<Frame caption="Les fichiers appartiennent au projet. Leur statut indique si le chat peut rechercher dans leur texte.">

![L’onglet Connaissances du projet Website relaunch contient deux fichiers indexés et des commandes pour créer des dossiers et importer des fichiers ou dossiers.](/images/platform/project-knowledge-files.webp)

</Frame>

## Importer au bon endroit

1. Ouvre le projet, puis **Connaissances**.
2. Sélectionne un dossier ou reste à la racine.
3. Clique sur **Ajouter un fichier** ou dépose des fichiers dans la zone d’import.
4. Vérifie que chacun apparaît au bon endroit et termine son indexation.

**Nouveau dossier** crée un dossier à la racine. **Nouveau sous-dossier** crée un dossier à l’intérieur d’un autre. **Ajouter un dossier** importe un dossier de ton appareil et reproduit sa structure à l’emplacement sélectionné. Un import de dossier est limité à 200 fichiers et 200 Mo. Divise les dossiers plus volumineux et vérifie les fichiers ignorés dans le compte rendu.

## Vérifier si le chat peut lire le fichier

| Statut | Signification et action |
| --- | --- |
| **En file d'attente** | Le fichier attend son traitement. |
| **Indexation…** | Tale prépare le texte pour la recherche. |
| **Indexé** | Le texte est consultable. Vérifie une réponse contre le fichier d’origine. |
| **Échec** | Consulte les détails disponibles et utilise **Réessayer l'indexation**. Si l’échec revient, demande l’aide d’un admin. |
| **Non pris en charge** | Ce contenu ne peut pas être indexé. Fournis du texte lisible ou un format pris en charge ; relancer le même fichier ne résout pas la cause. |
| **Non indexé** | Le fichier est stocké, mais pas consultable par recherche. Utilise **Indexer maintenant** si proposé, ou convertis un format sans extracteur de texte. |

Une intégration peut importer un fichier sans l’indexer. Il reste visible dans l’arborescence. Un fichier texte compatible peut être lu directement lorsqu’il est nommé, mais il n’apparaît pas dans la recherche textuelle avant indexation.

Les règles de l’organisation peuvent imposer des limites supplémentaires de taille ou de stockage. Si l’import échoue, commence par un petit fichier compatible. Un admin peut vérifier [Politiques et limites](/fr/platform/admin/governance/policies-and-limits), le stockage et le modèle d’embedding.

## Poser la question dans un chat du projet

Ouvre **Chats** dans ce projet, démarre une conversation et pose une question en nommant le fichier ou son sujet. L’assistant peut consulter les fichiers de ce projet et les documents de la bibliothèque auxquels tu as accès. Il ne peut pas lire les fichiers d’un autre projet depuis ce chat.

Le chat général de l’organisation ne recherche pas dans les fichiers des projets. Tant qu’ils appartiennent au projet, ces fichiers n’apparaissent ni dans la liste documentaire de l’organisation ni dans sa bibliothèque WebDAV. L’accès au projet détermine qui peut les lire ; ils n’ont pas d’équipes associées séparément.

## Remplacer un document maîtrisé en conservant la revue

Importer un autre fichier sous le même nom crée un document distinct. Un nom identique ne relie pas deux révisions. Pour qu’une approbation reste liée au fichier exact qui a été examiné, utilise **Marquer comme document maîtrisé** dans le menu de la ligne.

Le document maîtrisé commence en brouillon. **Remplacer le fichier** met à jour un brouillon ou ouvre le brouillon suivant à partir d’une version approuvée, tout en conservant cette dernière. **Soumettre à la relecture** fige le brouillon pour le relecteur désigné. [Documents maîtrisés](/fr/platform/knowledge/documents) décrit le cycle complet et les règles de revue.

## Déplacer vers les connaissances ou supprimer

**Retirer du projet** déplace le fichier vers la bibliothèque de connaissances de l’organisation. Cette action ne le supprime pas.

<Warning>

Retirer le fichier du projet le rend visible par toute l’organisation. N’utilise cette action que si tu souhaites réellement élargir son audience. Lis la confirmation avant de continuer.

</Warning>

Pour retirer le fichier entièrement, choisis **Supprimer** dans son menu et lis la confirmation. Supprimer un dossier retire aussi les fichiers, sous-dossiers et entrées de recherche qu’il contient. Ces actions ne peuvent pas être annulées depuis l’arborescence. Une conservation légale ou un document maîtrisé protégé peut empêcher la suppression.

**Supprimer** est proposé pour les fichiers téléversés ici et pour ceux qu’un agent a écrits dans le projet, comme des lectures ou des rapports générés. Un fichier synchronisé depuis un connecteur ne propose pas de suppression dans le projet, car la prochaine synchronisation le restaurerait ; retire-le plutôt à sa source.

Si un fichier sert à plusieurs projets indépendants, envisage une copie partagée avec les équipes appropriées dans la [bibliothèque de connaissances](/fr/platform/knowledge/documents). Évite de conserver plusieurs versions contradictoires de la même politique.
