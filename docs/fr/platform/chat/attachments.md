---
title: Pièces jointes
description: Types de fichiers pris en charge, où atterrissent les téléversements, quand le contenu est indexé en RAG et quand il est inséré tel quel dans le prompt.
---

Les pièces jointes permettent à un chat de référencer un fichier sans renvoyer l'utilisateur vers un autre onglet. Tu colles, tu glisses, ou tu cliques sur le contrôle d'upload du composer ; le fichier accompagne le message et Tale le route vers la bonne pipeline. La plupart des types de fichiers atterrissent tels quels dans l'entrée du modèle ; les fichiers gros ou structurés sont indexés et extraits par morceaux.

Cette page couvre seulement le mécanisme d'upload sur le composer. Les documents téléversés dans [Knowledge](/fr/platform/knowledge/documents) suivent un flux séparé avec une indexation persistante — les pièces jointes de chat sont scopées au chat qui les a reçues.

## Un téléversement déroulé

Colle un PDF dans le composer. Le composer affiche une puce avec le nom du fichier et un spinner ; la puce devient **Uploaded** une fois le fichier arrivé dans le stockage de Tale. **Envoie** le message, et l'agent reçoit une vue texte extraite du PDF en ligne avec ton prompt. Si le fichier est plus grand que le budget de contexte en ligne, Tale l'indexe et l'agent lit des chunks à la demande via son outil de récupération.

## Types pris en charge

Trois familles : **images**, **documents structurés** (PDF, DOCX, XLSX, PPTX), et **fichiers de type texte** (texte brut, markdown, code source, CSV, JSON, YAML). Les images vont au modèle vision que le chat utilise ; le sélecteur de modèles doit être sur un modèle capable de vision ou l'image sera silencieusement abandonnée. Les documents structurés sont extraits en texte — diagrammes, pages scannées et objets embarqués sont au mieux possible. Les fichiers de type texte atterrissent tels quels.

## Où vivent les téléversements

Chaque pièce jointe est stockée dans le stockage objet de Tale et liée au chat qui l'a reçue. Supprimer le chat déplace les pièces jointes dans la [Corbeille](/fr/platform/admin/governance/trash) avec l'historique des messages ; la restauration les ramène. Il n'y a pas de bibliothèque « pièces jointes du chat » séparée — pour partager un document à travers plusieurs chats, téléverse-le dans [Knowledge](/fr/platform/knowledge/documents) et lie-le à un agent.

## RAG versus tel quel

Les petits fichiers texte et les documents structurés sous le budget en ligne de l'agent sont insérés tels quels. Les plus grands sont chunked, embedded et indexés ; l'agent récupère les chunks pertinents à la réponse et les cite. La limite dépend du modèle — les modèles à long contexte avalent davantage entier. Quand l'agent récupère depuis une pièce jointe plutôt que de la lire entière, les citations pointent vers des plages de chunks dans le fichier d'origine.

## Où ça s'inscrit

Les pièces jointes sont le moyen léger, scopé au chat, d'amener un fichier dans une réponse. L'équivalent lourd, scopé à l'organisation, est [Documents](/fr/platform/knowledge/documents) — même pipeline d'indexation, mais lié à des agents au lieu d'un seul chat. La page à lire ensuite dépend de ce que tu essaies de faire — si le fichier compte une fois, attache-le ici ; s'il comptera encore, téléverse-le dans Knowledge et laisse un agent le référencer depuis chaque chat.
