---
title: Documents
description: Importe des fichiers de référence partagés, vérifie leur disponibilité dans la recherche et maintiens les imports et révisions approuvées.
---

Utilise **Connaissances > Documents** pour les fichiers de la bibliothèque commune : politiques, guides, rapports et justificatifs. Les membres lisent les documents auxquels ils ont accès. Les rôles Éditeur et supérieurs peuvent les importer et les gérer. Les contenus propres à un seul projet appartiennent à son [onglet Connaissances](/fr/platform/projects/manage-files).

<Frame caption="La liste réunit le fichier original, sa provenance, son indexation et l’accès par équipe. Le filtre ne conserve que les fichiers chargés et indexés.">

![L’onglet Documents présente les fichiers partagés avec leur taille, source, statut RAG et équipes.](/images/get-started/documents-list.webp)

</Frame>

## Importer depuis ton appareil

1. Ouvre **Connaissances > Documents** et le dossier de destination. Crée-le avec **Nouveau dossier** si nécessaire.
2. Choisis **Téléverser des documents > Depuis ton appareil**, puis les fichiers.
3. Attends la fin de l’import et retrouve les lignes dans le tableau.
4. Ouvre un document pour vérifier son aperçu et ses détails. Consulte le **Statut RAG** avant de poser une question sur son contenu.

Choisis un nom de fichier explicite, avec une date ou une révision si cela aide à distinguer les sources. Importer un autre fichier du même nom crée un document séparé ; cela ne remplace pas l’existant.

## Distinguer stockage et recherche

Un fichier enregistré n’est pas forcément interrogeable. Tale doit pouvoir en extraire le texte avant de l’indexer pour la recherche dans les connaissances.

| Format | Résultat attendu |
| --- | --- |
| PDF avec texte intégré, `.docx`, `.xlsx`, `.pptx`, `.odt`, CSV, texte brut | Extraction et indexation prises en charge. Vérifie le résultat pour le fichier concerné. |
| Anciens formats Office `.doc`, `.xls`, `.ppt` | Stockage et téléchargement possibles. Convertis-les dans un format moderne pour l’indexation. |
| Images comme JPG, PNG, GIF, WEBP | Stockage et téléchargement possibles. L’index de connaissances n’en extrait pas le texte. |
| PDF scanné sans texte lisible | Fournis une version traitée par OCR ou contenant du texte pour rendre le contenu recherchable. |

Réindexer plusieurs fois un format non pris en charge ne le rend pas interrogeable. Pour une question sur une image, consulte [Pièces jointes du chat](/fr/platform/chat/attachments) : un modèle de vision disponible peut y lire l’image directement.

## Lire le statut d’indexation

| Statut | Signification et action |
| --- | --- |
| **En file d'attente** | Attend une place d’indexation. Une bibliothèque chargée traite les fichiers progressivement. |
| **Indexation** | Le texte est préparé pour la recherche. Attends avant de tester la source. |
| **Indexé** | L’indexation est terminée. Pose une question précise et ouvre sa citation. |
| **Réindexation nécessaire** | L’index est périmé. Utilise **Relancer l'indexation** à côté du statut. |
| **Échoué** | Lis l’erreur, résous sa cause, puis réessaie. |
| **Non pris en charge** | Ce contenu ne peut pas être indexé : format incompatible, texte vide ou illisible, ou PDF endommagé, par exemple. Ouvre le badge pour connaître la cause. |
| **Non indexé** | Aucun index terminé n’est disponible. Vérifie le fichier et lance l’indexation lorsque l’action est proposée. |

Les traitements interrompus reprennent en arrière-plan ou signalent un échec avec une option de relance. Si le statut n’avance pas, transmets le nom du document et l’erreur à un administrateur. Il peut vérifier les services d’indexation et la configuration des embeddings. Les fichiers échoués ou non pris en charge occupent toujours du stockage jusqu’à leur suppression.

## Résoudre un problème d’indexation

Clique sur **Échoué** ou **Non pris en charge** pour lire l’explication. La correction dépend de la cause, pas seulement de l’extension du fichier.

| Cause | Action à entreprendre |
| --- | --- |
| Format non pris en charge ou image | Convertis la source en document pris en charge contenant du texte lisible. Importer une image seule ne lance pas d’OCR pour la recherche dans les connaissances. |
| Texte vide ou PDF scanné sans couche de texte | Ajoute le contenu manquant ou fournis une version traitée par OCR. Un fichier composé uniquement d’espaces et de sauts de ligne est également vide. |
| Données binaires sous une extension de texte | Exporte du texte lisible, de préférence en UTF-8. Renommer un fichier binaire en `.txt` ne le convertit pas. |
| PDF impossible à lire | Vérifie que l’original s’ouvre, retire sa protection par mot de passe si tu y es autorisé, ou exporte un nouveau PDF. Un fichier Office endommagé peut afficher une erreur d’indexation générale ; vérifie l’original avant de multiplier les essais. |
| Secret détecté ou règle sur les données personnelles | Retire les identifiants de la source ou demande à un administrateur de vérifier la règle signalée. Importe ensuite le contenu corrigé, ou relance après correction de la configuration. |
| Modèle d’embedding absent ou compte refusé par le fournisseur | Un administrateur doit configurer le modèle dans **Paramètres > Résidence des données**, ou corriger la clé, l’accès au modèle, l’offre ou le solde du compte. Relance ensuite. |
| Panne temporaire du fournisseur ou du service d’indexation | Les traitements en arrière-plan retentent les échecs temporaires. Si l’erreur persiste, transmets le nom du document et le message à un administrateur. Après réparation, utilise **Relancer l'indexation**. |
| Reconstruction ou réparation du moteur de recherche | La reconstruction peut se terminer automatiquement. Si la réparation échoue, l’exploitant doit réparer ou restaurer la base de connaissances avant une nouvelle tentative. |

**Non pris en charge** ne propose pas de relance : traiter les mêmes octets ne corrigerait pas la cause. Un statut **Échoué** peut lui aussi nécessiter une modification de la source ou de la configuration. Une application distingue ces cas avec `indexing.errorCode` ; la [référence API](/fr/develop/api-reference) donne les codes stables.

<Frame caption="Le dialogue explique que ce document ne contient aucun texte à indexer. Ajoute du contenu lisible avant de l’importer à nouveau.">

![Le dialogue en anglais signale un document vide ou un scan sans couche de texte et recommande une version texte lisible.](/images/platform/document-indexing-unsupported.webp)

</Frame>

## Choisir qui peut lire le document

Les documents de la bibliothèque sont accessibles à **Toute l'organisation** par défaut. Utilise **Assigner une équipe** dans le menu de la ligne pour restreindre l’accès aux équipes choisies. Ces restrictions s’appliquent aussi à la recherche : un agent ne peut pas y rendre visible un document inaccessible.

La racine de la bibliothèque affiche les dossiers et les documents qui ne sont rangés dans aucun dossier. Ouvre un dossier pour consulter son contenu : les documents qu’il contient n’apparaissent pas aussi comme lignes de fichiers à la racine.

Les dossiers organisent la bibliothèque. Vérifie l’accès dans **Équipes** et la provenance dans **Source**. Les fichiers de projet ont leur propre périmètre et n’apparaissent pas dans cette bibliothèque. Consulte [Connaissances](/fr/platform/knowledge/overview) pour choisir où conserver une source.

## Importer depuis Microsoft 365 ou Google Drive

Choisis **Depuis Microsoft 365** ou **Depuis Google Drive** sous **Téléverser des documents**. À la première utilisation, connecte ton compte et autorise l’import. Si Tale indique qu’il n’est pas configuré, un administrateur doit préparer le service dans [Connecteurs](/fr/platform/admin/connectors).

Sélectionne les fichiers ou dossiers, puis le mode d’import :

| Mode | Résultat |
| --- | --- |
| **Importation unique** | Copie une fois la sélection en conservant les dossiers. Les changements ultérieurs de la source ne modifient pas cette copie. |
| **Importation synchronisée** | Maintient la sélection prise en charge à jour. Les nouveaux fichiers arrivent lors d’un prochain passage ; les fichiers modifiés sont réindexés ; ceux supprimés à la source disparaissent de la copie. |

Démarrer la synchronisation d’un dossier peut aussi réorganiser un import antérieur. Si le même fichier source existe déjà dans Tale, la synchronisation reprend ce document et le déplace dans le dossier synchronisé correspondant, même si son contenu n’a pas changé. La correspondance repose sur l’identité du fichier source, pas uniquement sur son nom. Une synchronisation sans dossier de destination conserve l’emplacement existant.

Pour Microsoft 365, choisis **Mon OneDrive** ou **Sites SharePoint**. La synchronisation concerne les dossiers OneDrive personnels ; SharePoint s’importe une seule fois. Pour Google Drive, sélectionne dans Mon Drive. Les Docs, Sheets et Slides natifs sont ignorés : exporte-les d’abord en PDF ou au format Office.

Si un dossier est trop grand pour être listé entièrement, Tale refuse l’import. Sélectionne des sous-dossiers plus petits ou utilise la synchronisation lorsqu’elle est disponible. Si le dossier ou le fichier source sélectionné est supprimé, sa copie est retirée et la synchronisation prend fin.

Pour conserver les fichiers sans nouvelles mises à jour, choisis **Arrêter la synchronisation** sur la ligne du fichier ou du dossier. Supprimer l’élément importé arrête aussi sa synchronisation. Ces actions ne touchent pas les originaux dans OneDrive ou Google Drive. **Déconnecter Google Drive** dans le dialogue d’import révoque la connexion ; reconnecte-toi pour importer à nouveau.

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

Ouvre l’aperçu du document et vérifie qu’il affiche le fichier de remplacement. Ouvre ensuite le menu de la ligne et clique sur **Soumettre à la relecture**. Le sélecteur ne propose que les membres qui peuvent réellement ouvrir le document — un fichier de projet exige l’accès en édition au projet — et jamais toi. Seul le relecteur que tu désignes peut approuver ou demander des modifications, chaque relecture est donc un second regard.

Tale fige le brouillon pendant que le relecteur statue sur ce fichier exact ; le relecteur est prévenu par la cloche et par e-mail, et la décision te revient par le même chemin — une demande de modifications porte le retour du relecteur, que la boîte de dialogue de soumission affiche aussi avant ta prochaine tentative.

Si le relecteur ne peut plus statuer — il a quitté l’organisation, a été désactivé ou a perdu l’accès au document —, ouvre le menu de la ligne et clique sur **Changer de relecteur** : la demande en attente passe au membre que tu désignes, et l’enregistrement reste figé sur le même fichier.

</Step>

</Steps>

## Examiner le contenu avant de supprimer

**Supprimer** retire le document et son contenu indexé. La confirmation explique les conséquences ; garde une copie si tu auras besoin du fichier plus tard. Un nouvel import crée un nouveau document.

<Warning>

Supprimer un dossier retire définitivement ses fichiers et sous-dossiers. Pour un dossier synchronisé, cela retire aussi la configuration et l’historique de synchronisation. Les originaux dans Microsoft 365 ou Google Drive restent intacts.

</Warning>

Un document maîtrisé avec une version approuvée est protégé contre la suppression, y compris pendant la préparation d’un nouveau brouillon. Son menu affiche **Document maîtrisé protégé**. Un dossier qui en contient un ne peut pas non plus être supprimé. Une conservation légale peut également bloquer les modifications ou la suppression. Demande à un administrateur de vérifier la restriction au lieu de la contourner par des imports en double.
