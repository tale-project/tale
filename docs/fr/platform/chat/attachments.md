---
title: Pièces jointes
description: Les types de fichiers pris en charge, où atterrissent les téléversements, quand le contenu est indexé en RAG et quand il est inséré tel quel dans le prompt.
---

Les pièces jointes permettent à un chat de référencer un fichier sans renvoyer l’utilisateur vers un autre onglet. Tu colles, tu glisses, ou tu choisis **Ajouter photos et fichiers** dans le menu plus du chat ; le fichier accompagne le message et Tale le route vers le bon pipeline. La plupart des types de fichiers atterrissent tels quels dans l’entrée du modèle ; les fichiers volumineux ou structurés sont indexés et lus par extraits.

Cette page couvre uniquement le mécanisme de téléversement sur le chat. Les documents téléversés dans [Connaissances](/fr/platform/knowledge/documents) suivent un flux séparé avec une indexation persistante — les pièces jointes de chat restent limitées au chat qui les a reçues.

## Un téléversement déroulé

Colle un PDF dans le chat. Le chat affiche une puce avec le nom du fichier et un spinner ; la puce se stabilise une fois le fichier arrivé dans le stockage de Tale. Envoie le message, et l’agent reçoit une vue texte extraite du PDF, en ligne avec ton prompt. Si le fichier dépasse le budget de contexte en ligne, Tale l’indexe et l’agent lit des chunks à la demande via son outil de récupération.

## Types pris en charge

Trois familles : les **images**, les **documents structurés** (PDF, DOC/DOCX, ODT, XLS/XLSX, PPT/PPTX) et les **fichiers de type texte** (texte brut, markdown, code source, CSV, JSON, YAML). Les images vont au modèle vision que le chat utilise ; le sélecteur de modèles doit être sur un modèle capable de vision, sinon l’image est abandonnée en silence. Les documents structurés sont extraits en texte — diagrammes, pages scannées et objets embarqués relèvent du meilleur effort. Les fichiers de type texte atterrissent tels quels.

## Où vivent les téléversements

Chaque pièce jointe est stockée dans le stockage objet de Tale et liée au chat qui l’a reçue, et elle est aussi copiée dans la sandbox du chat sous `/user/uploads/<name>`. C’est sur cette seconde copie que travaillent les outils `file_read`, `file_list` et `run_code` de l’agent : les octets réels, pas seulement la vue texte extraite qui accompagne ton prompt en ligne. Supprimer le chat déplace les pièces jointes dans la [Corbeille](/fr/platform/admin/governance/trash) avec l’historique des messages ; la restauration les ramène. Il n’existe pas de bibliothèque « pièces jointes de chat » séparée — pour partager un document entre plusieurs chats, téléverse-le dans [Connaissances](/fr/platform/knowledge/documents) et lie-le à un agent.

## RAG versus tel quel

Les petits fichiers texte et les documents structurés sous le budget en ligne de l’agent sont insérés tels quels. Les plus gros sont découpés en chunks, embarqués et indexés ; l’agent récupère les chunks pertinents au moment de la réponse et les cite. La frontière dépend du modèle — les modèles à long contexte avalent davantage en entier. Quand l’agent récupère depuis une pièce jointe plutôt que de la lire entière, les citations pointent vers des plages de chunks dans le fichier d’origine.

## Référencer des documents de la base de connaissances avec @

<Frame caption="Taper @ ouvre le sélecteur de la base de connaissances au-dessus du chat.">

![La zone de saisie du chat avec une arobase tapée et le sélecteur de la base de connaissances ouvert, listant trois documents texte indexés.](/images/platform/chat-mention-picker.webp)

</Frame>

Taper `@` dans le chat ouvre un sélecteur sur les connaissances indexées de l’organisation — réparti en une section **Documents** et une section **Dossiers**. Tape pour filtrer par nom ; `@fichier` épingle un document sous une puce **Connaissances**, `@dossier` épingle un dossier et tout ce qui est indexé dessous sous une puce **Dossier**. À l’envoi, Tale vérifie ton accès, restreint la récupération de cette réponse exactement aux entrées épinglées — un dossier s’étend à son sous-arbre indexé — et injecte les passages pertinents même quand le mode connaissances de l’agent est désactivé, car une mention explicite l’emporte sur la configuration de récupération de l’agent. Jusqu’à cinq entrées, documents et dossiers confondus, peuvent être épinglées par message.

Les puces sont la source de vérité : supprimer le texte `@Titre` du message ne désépingle pas la référence — retire plutôt la puce. Le sélecteur ne propose que des documents dont l’indexation est terminée et auxquels tes équipes ont accès. Dans un chat de projet, il liste en plus les fichiers et dossiers propres au projet, en tête ; les fichiers d’un projet restent limités au projet et n’apparaissent jamais dans le sélecteur `@` d’un chat en dehors de celui-ci — voir [Gérer les fichiers du projet](/fr/platform/projects/manage-files). La référence vaut par message ; une question de suivi sans mention retombe sur le périmètre de connaissances normal de l’agent.

## Où ça s’inscrit

Les pièces jointes sont le moyen léger, limité au chat, d’amener un fichier dans une réponse. L’équivalent lourd, à l’échelle de l’organisation, est [Documents](/fr/platform/knowledge/documents) — même pipeline d’indexation, mais lié à des agents au lieu d’un seul chat. La page à lire ensuite dépend de ce que tu cherches à faire — si le fichier compte une fois, attache-le ici ; s’il comptera encore, téléverse-le dans Connaissances et laisse un agent le référencer depuis chaque chat.
