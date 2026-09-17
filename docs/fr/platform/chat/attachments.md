---
title: Poser des questions sur des fichiers et des images
description: Joins un document, une image ou un enregistrement au chat et vérifie quand son contenu est prêt à être utilisé.
---

Joins un fichier lorsqu’il sert à la conversation en cours. L’assistant reçoit les images, consulte le texte des documents compatibles et lit les transcriptions des enregistrements. Pour réutiliser des fichiers dans plusieurs chats, place-les dans un [projet](/fr/platform/projects/manage-files) ou dans la [bibliothèque de connaissances](/fr/platform/knowledge/documents).

## Ajouter une pièce jointe

Ouvre le menu `+` près du champ de message et choisis **Ajouter photos et fichiers**. Tu peux aussi déposer des fichiers sur le champ ou y coller une capture d’écran. Un message peut contenir jusqu’à dix fichiers.

Les images apparaissent en miniature. Les autres fichiers apparaissent sous forme de pastilles avec leur nom et l’état du traitement. Vérifie les noms avant l’envoi. Retire une pièce jointe préparée avec sa commande de suppression si elle ne doit pas accompagner le message.

<Frame caption="Un document préparé affiche son nom et l’état du traitement avant l’envoi de la question.">

![Le champ de saisie affiche un document joint au-dessus du message, avec son état de traitement et une commande pour le retirer.](/images/platform/chat-document-attachment.webp)

</Frame>

Précise ce que l’assistant doit chercher, par exemple : « Lis le compte rendu et liste les décisions, leurs responsables et les échéances manquantes. » Joindre un fichier seul ne suffit pas à expliquer le résultat attendu.

Quand tu essaies de joindre de l’audio ou de la vidéo, Tale vérifie si l’organisation dispose d’un modèle de transcription disponible. Si cette vérification empêche l’import, une boîte de dialogue explique le problème et propose les actions auxquelles tu as accès. Ces fichiers sont refusés avant leur transfert ; les autres fichiers compatibles de la même sélection peuvent toujours être importés. Ferme la boîte de dialogue pour continuer à écrire, ouvre le réglage proposé si tu y as accès, ou demande à un admin de vérifier les [Modèles](/fr/platform/admin/governance/content-models).

## Comprendre ce que reçoit le modèle

| Pièce jointe | Contenu utilisé | Vérification |
| --- | --- | --- |
| Image ou capture collée | L’image elle-même, si le modèle sait lire les images. | Choisis un modèle compatible et vérifie que le texte est lisible. |
| PDF, document Office récent ou fichier texte compatible | Texte accessible par les outils de consultation de l’assistant. | Attends le traitement et vérifie qu’une étape de lecture apparaît dans la réponse. |
| Fichier audio ou vidéo | Une transcription en texte. | Un admin doit configurer la transcription. Compare les noms, nombres et termes spécialisés avec l’enregistrement. |
| Ancien fichier Office sans extracteur de texte | Le nom du fichier, sans texte consultable. | Enregistre-le en `.docx`, `.xlsx` ou `.pptx` et joins cette copie. |

Accepter un fichier à l’import et en extraire le texte sont deux opérations distinctes. La présence d’un fichier dans le chat ne signifie pas nécessairement que l’assistant peut en lire le contenu.

## Envoyer pendant le traitement

Si des documents ou enregistrements sont encore en traitement au moment de l’envoi, Tale met le message en attente, puis l’envoie lorsqu’ils sont prêts. Le message en attente apparaît au-dessus du champ. Annule-le à cet endroit pour modifier la question ; son texte revient dans le champ.

Colle un lien vidéo compatible dans le champ du message pour lancer la création d’une pièce jointe. Une URL saisie au clavier reste du texte ordinaire. Tale récupère d’abord les sous-titres et transcrit l’audio si aucun n’est disponible, puis fournit le texte à l’assistant. Tu peux toujours coller un lien sans modèle de transcription, car les sous-titres utilisables n’en ont pas besoin. Si ce lien échoue, réessaie ou retire-le avant d’envoyer.

Un changement de modèle s’applique aux nouvelles transcriptions ; les pièces jointes déjà traitées conservent leur texte. Importer à nouveau les mêmes octets réutilise le travail terminé pour la même cible de transcription, mais relance la transcription si le fournisseur ou le modèle cible diffère.

## Choisir le bon emplacement

Les pièces jointes appartiennent à cette conversation. Elles ne rejoignent pas automatiquement la bibliothèque de l’organisation et ne deviennent pas accessibles dans un autre chat. Changer de conversation retire les pièces jointes préparées : vérifie les pastilles après un changement de chat.

Une réponse régénérée utilise les pièces jointes enregistrées avec le message d’origine. Pour poser une question sur une autre version, envoie le nouveau fichier et indique laquelle l’assistant doit utiliser.

<Tip>

Pour des questions récurrentes sur un brief ou une politique, ajoute le fichier une fois dans le projet approprié. Démarre les chats suivants dans ce projet au lieu d’importer une copie à chaque fois.

</Tip>

## Résoudre un problème de pièce jointe

| Symptôme | Action |
| --- | --- |
| Le modèle choisi ne peut pas lire l’image | Choisis un modèle compatible. Auto tient compte des modèles capables de lire les images ; s’il n’y en a aucun, demande à un admin d’en configurer un. |
| Le traitement échoue | Réessaie. Si un petit fichier compatible échoue aussi, demande à un admin de vérifier le stockage, l’indexation ou la transcription selon l’erreur. |
| L’assistant connaît le nom, mais pas le contenu | Vérifie le format et l’état du traitement. Convertis les anciens fichiers dans un format récent compatible. |
| La réponse invente des détails d’un enregistrement | Compare la transcription à l’enregistrement et fournis le passage corrigé avant de continuer. |
| Un message reste en attente | Vérifie chaque pièce jointe, y compris les liens vidéo. Retire les éléments en échec ou relance leur traitement. |

Reviens à [Poser des questions dans le chat](/fr/platform/chat/basics) pour vérifier les sources et poursuivre l’échange.
