---
title: Documents
description: L’onglet Documents est l’endroit où les éditeurs téléversent des fichiers dans la base de connaissances, suivent leur indexation et gèrent leur cycle de vie — sources de téléversement, statut RAG, portée par équipe, dossiers et réindexation.
---

L’onglet Documents est la surface fichiers de la base de connaissances. Les éditeurs téléversent des fichiers, Tale fait passer chacun par le pipeline d’indexation — extraire le texte, le découper, calculer les embeddings, les stocker — et les agents dont le périmètre de connaissances couvre le document récupèrent les passages pertinents au moment de répondre et les citent. Cette page couvre le côté opérateur : le téléversement, la colonne de statut, la portée par équipe, les dossiers et le cycle de vie d’un document.

<Frame caption="La table des documents — taille, source, statut RAG et portée d’équipe par fichier.">

![L’onglet Documents de la base de connaissances listant trois fichiers texte téléversés avec les colonnes taille, source, statut RAG et équipes.](/images/get-started/documents-list.webp)

</Frame>

## Téléverser

Ouvre **Connaissances > Documents** et clique sur **Téléverser des documents** — le menu propose **Depuis ton appareil**, **Depuis Microsoft 365** et **Depuis Google Drive**. Le portail de téléversement accepte les formats qui couvrent l’essentiel des connaissances d’une organisation : PDF, Word (`.doc`, `.docx`), texte OpenDocument (`.odt`), PowerPoint (`.ppt`, `.pptx`), Excel (`.xls`, `.xlsx`), CSV, texte brut et images (JPG, PNG, GIF, WEBP). Tout le reste est refusé dès le téléversement.

Téléverser et indexer sont deux faits distincts, et la colonne **Statut RAG** suit le second : **Indexation** pendant que le pipeline tourne, **Indexé** quand les agents peuvent récupérer le contenu, **Échoué** quand le pipeline a rencontré une erreur, et **Réindexation nécessaire** quand les fragments stockés sont périmés. Les formats modernes s’indexent ; le trio Office historique (`.doc`, `.xls`, `.ppt`) se téléverse et reste téléchargeable mais affiche **Non indexé** — les agents ne peuvent pas récupérer son contenu tant que tu ne l’as pas réenregistré au format moderne.

## Réviser un document maîtrisé

Utilise un document maîtrisé quand l’approbation doit rester liée au fichier exact que le relecteur a vu. Remplacer le fichier de son brouillon met à jour l’enregistrement existant ; téléverser un autre fichier du même nom crée toujours un document distinct.

<Steps>

<Step title="Choisir le document maîtrisé">

Pour un téléversement ordinaire, ouvre le menu de la ligne et clique sur **Marquer comme document maîtrisé**. L’enregistrement passe à `v1 · Brouillon`. Un document approuvé propose **Remplacer le fichier** et **Nouvelle révision**. Utilise **Nouvelle révision** seulement si tu veux ouvrir le brouillon suivant sans remplacer son fichier.

</Step>

<Step title="Remplacer le fichier actuel">

Ouvre le menu de la ligne d’un brouillon ou d’un document approuvé et clique sur **Remplacer le fichier**, puis choisis un fichier au même format. Un brouillon garde sa révision actuelle. Pour un document approuvé, Tale conserve la vN approuvée et n’ouvre le brouillon vN+1 qu’une fois le remplacement terminé ; si tu annules ou si le téléversement échoue, la vN reste approuvée. Une conservation légale bloque les deux parcours.

<Frame caption="La boîte de dialogue accepte un seul fichier au format actuel du document.">

![La boîte de dialogue « Remplacer le fichier » d’un document texte maîtrisé, avec un sélecteur de fichier au même format et un rappel que les versions approuvées restent dans l’historique.](/images/platform/controlled-document-replace-file.webp)

</Frame>

</Step>

<Step title="Vérifier et soumettre la révision">

Ouvre l’aperçu du document et vérifie qu’il affiche le fichier de remplacement. Ouvre ensuite le menu de la ligne et clique sur **Soumettre à la relecture**. Le sélecteur ne propose que les membres qui peuvent réellement ouvrir le document — un fichier de projet exige l’accès en édition au projet. Tale fige le brouillon pendant que le relecteur statue sur ce fichier exact ; le relecteur est prévenu par la cloche et par e-mail, et la décision te revient par le même chemin — une demande de modifications porte le retour du relecteur, que la boîte de dialogue de soumission affiche aussi avant ta prochaine tentative.

</Step>

</Steps>

## Importer depuis Microsoft 365

**Depuis Microsoft 365** est toujours dans le menu de téléversement. La première fois, Tale te demande d’autoriser OneDrive et SharePoint pour importer dans Documents. Si la boîte de dialogue indique que l’import n’est pas encore configuré, un admin de l’organisation configure d’abord l’app OAuth sous **Paramètres > Connectors > Apps OAuth** (ou l’opérateur en enregistre une sur le déploiement). Ensuite, choisis des fichiers ou des dossiers sous **Mon OneDrive** ou **Sites SharePoint**, puis le mode d’importation. **Importation unique** apporte les fichiers une fois — ils se comportent comme des téléversements depuis le disque. **Importation synchronisée** garde la sélection synchronisée : les nouveaux fichiers du dossier OneDrive apparaissent lors d’un passage de sync ultérieur, les fichiers modifiés sont réindexés, et les fichiers supprimés à la source quittent l’espace de travail. Les deux modes préservent la structure de dossiers de ta sélection. La synchronisation couvre les dossiers OneDrive personnels — une sélection SharePoint s’importe toujours une seule fois.

Pour arrêter la synchronisation — d’un dossier synchronisé entier ou d’un seul fichier synchronisé — ouvre le menu de la ligne et clique sur **Arrêter la synchronisation** ; les documents importés restent dans l’espace de travail et cessent d’être mis à jour. Supprimer un dossier ou un fichier synchronisé arrête aussi sa synchronisation. Dans tous les cas, les fichiers dans OneDrive restent intacts.

## Importer depuis Google Drive

**Depuis Google Drive** est toujours dans le menu de téléversement. La première fois, Tale te demande d’autoriser Google Drive pour importer dans Documents. Si la boîte de dialogue indique que l’import n’est pas encore configuré, un admin de l’organisation configure d’abord l’app OAuth sous **Paramètres > Connectors > Apps OAuth** (ou l’opérateur en enregistre une sur le déploiement). Ensuite, choisis des fichiers ou des dossiers dans Mon Drive, puis le mode d’importation. **Importation unique** apporte les fichiers une fois — ils se comportent comme des téléversements depuis le disque. **Importation synchronisée** garde la sélection alignée : les nouveaux fichiers du dossier Drive apparaissent au prochain passage de sync, les fichiers modifiés sont réindexés, et les fichiers supprimés à la source quittent l’espace de travail. Les deux modes préservent la structure de dossiers de ta sélection. Les Docs, Sheets et Slides natifs Google sont ignorés — exporte-les d’abord en PDF ou format Office si tu en as besoin dans Documents.

Pour arrêter la synchronisation — un dossier synchronisé entier ou un fichier synchronisé seul — ouvre le menu de la ligne et clique sur **Arrêter la synchronisation** ; les documents importés restent dans l’espace de travail et cessent de se mettre à jour. Supprimer un dossier ou un fichier synchronisé arrête aussi sa sync. Dans tous les cas, les originaux dans Google Drive ne sont pas touchés.

Utilise **Déconnecter Google Drive** dans l’en-tête du dialogue d’importation pour révoquer l’autorisation ; reconnecte-toi quand tu veux importer d’autres fichiers.

## Portée, dossiers, sources

Chaque ligne porte une cellule **Équipes** — **Toute l'organisation** par défaut, ou les équipes que tu choisis via **Assigner une équipe** dans le menu de la ligne. Un document limité à une équipe est invisible pour les membres et les agents hors de cette équipe ; c’est le levier d’accès de la base de connaissances. Les fichiers de projet sont entièrement hors de ce modèle : l’onglet **Connaissances** d’un projet contient des fichiers scopés à ce seul projet, et ils n’apparaissent ni dans cette bibliothèque ni dans sa portée par équipe — voir [Gérer les fichiers](/fr/platform/projects/manage-files).

**Nouveau dossier** garde les grandes bibliothèques navigables, et les connectors apportent leur propre structure : les documents synchronisés depuis OneDrive, SharePoint ou Google Drive atterrissent dans des dossiers de synchronisation et affichent leur origine dans la colonne **Source**, ce qui garde les citations traçables jusqu’au système amont.

<Warning>

Supprimer un dossier supprime définitivement chaque fichier et sous-dossier qu’il contient. Supprimer un dossier de synchronisation OneDrive ou Google Drive retire aussi sa configuration de synchronisation automatique et son historique — mais jamais les fichiers dans OneDrive ou Google Drive eux-mêmes.

</Warning>

## Réindexer et supprimer

**Réindexer** (menu de la ligne) refait passer le pipeline sur le fichier stocké — le bon geste après un échec d’indexation ou quand un document affiche **Réindexation nécessaire**. **Supprimer** retire le document et ses fragments indexés ; la confirmation le dit sans détour — l’action est irréversible. Retéléverser le même fichier ramène le contenu sous la forme d’un nouveau document. Un document maîtrisé cesse d’être supprimable dès qu’une de ses versions est approuvée — en relecture, approuvé ou avec le brouillon suivant ouvert, l’entrée du menu affiche **Document maîtrisé protégé**, et un dossier qui en contient un refuse la suppression du dossier de la même façon. L’instantané approuvé est un enregistrement conservé ; c’est précisément le rôle du cycle de vie.

Chaque document affiche un statut : **En file** (en attente — une organisation chargée indexe quelques fichiers à la fois et le reste patiente), **Indexation**, **Indexé**, **Échoué** ou **Non pris en charge** (un ancien format comme `.doc`/`.ppt`/`.xls` qui se stocke et se télécharge sans souci mais n’a pas d’extracteur de texte, donc jamais indexé pour la recherche). Une indexation interrompue par un délai dépassé ou un redémarrage du backend se rétablit d’elle-même en quelques minutes — elle est relancée ou marquée **Échoué** avec une option de reprise, jamais laissée bloquée. Si ton organisation applique un quota de stockage par utilisateur, les fichiers échoués et non pris en charge comptent toujours dedans jusqu’à leur suppression : libérer de l’espace revient donc à retirer les fichiers dont tu n’as plus besoin.

Cliquer sur un document ouvre l’aperçu, avec un panneau latéral qui montre la taille, la source, le statut RAG, les équipes, l’auteur du téléversement et la date de modification — le moyen le plus rapide de vérifier ce que vise réellement une citation.

## Documents ou données structurées

Les documents sont la moitié non structurée de la base de connaissances. Quand le contenu est une liste d’éléments partageant les mêmes champs — contacts, produits, fournisseurs — une fiche typée sert mieux les agents qu’un tableur téléversé : des valeurs exactes au lieu de passages récupérés. Les règles de décision vivent dans [Données structurées](/fr/platform/knowledge/structured-data).

## Où cela s’inscrit

Les documents sont le coin le plus utilisé de la base de connaissances — la plupart des citations, dans la plupart des réponses, pointent ici. Le volet récupération — comment le périmètre de connaissances d’un agent décide de ce qu’il interroge — est [Connaissances de l’agent](/fr/platform/agents/knowledge) ; la surface sœur au format fait est [Entrées de connaissances](/fr/platform/knowledge/knowledge-entries), qui emprunte le même pipeline un document à la fois.
