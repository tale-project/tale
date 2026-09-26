---
title: Poser des questions dans le chat
description: Envoie un message, choisis un modèle, vérifie les sources et conserve les conversations utiles.
---

Utilise le chat pour poser une question, comprendre un document ou rechercher une information dans Tale. L’assistant peut parcourir les connaissances accessibles et lire des pages publiques. Commence par une question précise, puis affine la réponse avec des messages de suivi.

<Frame caption="Le chat conserve ta question, les étapes de l’assistant et sa réponse dans le même échange.">

![Un chat sur les retours d’onboarding affiche la question et une réponse qui présente trois thèmes dans un tableau.](/images/platform/chat-thread-reply.webp)

</Frame>

## Envoyer un premier message

Ouvre **Accueil**. Sur ordinateur, le chat que tu as lu en dernier se rouvre, s’il y en a un. Pour aborder un nouveau sujet, choisis **Nouveau chat** en haut de la liste d’**Accueil** ou, sur ordinateur, sélectionne à nouveau **Accueil** alors que cette section est active. Écris dans le champ de message. Appuie sur **Entrée** pour envoyer ou sur **Maj+Entrée** pour aller à la ligne. Une suggestion de départ joue le même rôle que ta propre question : précise la source, le sujet et le type de réponse attendu.

Par exemple : « Retrouve les retours d’onboarding et résume les trois problèmes les plus fréquents. Cite les documents et sépare les problèmes signalés de tes suggestions. »

Si ton organisation a activé un avis de confidentialité, il s’affiche sous le champ de message pour te rappeler ce qu’il ne faut pas partager dans le chat.

Pendant la génération, la commande d’envoi devient une commande d’arrêt. L’arrêter conserve le texte déjà reçu, même s’il se termine au milieu d’une phrase. Pose une question de suivi pour clarifier la demande ou obtenir un détail manquant.

## Choisir un modèle lorsque c’est utile

Le sélecteur démarre sur **Auto** lorsque plusieurs modèles utilisables sont disponibles. Auto choisit un modèle pour chaque message parmi ceux de ton organisation. Les règles de l’organisation peuvent définir un choix par défaut ou restreindre les modèles autorisés. Les détails sous la réponse indiquent celui qui a effectivement répondu.

Choisis un modèle précis pour comparer des réponses dans les mêmes conditions ou lorsque tu sais lequel convient au travail. Il reste sélectionné jusqu’à ce que tu changes ce choix, y compris le fournisseur qui sert le modèle lorsque deux fournisseurs proposent le même. S’il permet de régler l’effort de raisonnement, le sélecteur propose aussi ce réglage. Un effort plus élevé peut prendre plus de temps ; il ne remplace pas la vérification du résultat.

<Frame caption="Le sélecteur de modèle se trouve à côté du menu des pièces jointes et des commandes vocales.">

![Le champ de message affiche le menu plus, le modèle Auto, un microphone et le bouton d’envoi.](/images/platform/chat-composer.webp)

</Frame>

Si aucun modèle n’est disponible, demande à un admin de vérifier les identifiants actifs des fournisseurs et les règles d’accès. La page [Modèles](/fr/platform/models) explique la composition du catalogue.

## Fournir les bonnes sources

Choisis l’emplacement du chat avant de poser des questions sur des fichiers :

| Emplacement | Fichiers consultables par l’assistant |
| --- | --- |
| Chat général de l’organisation | Documents accessibles de la bibliothèque et pièces jointes propres au chat. |
| Chat dans un projet | Fichiers de ce projet, documents accessibles de la bibliothèque et pièces jointes du chat. |
| Lien vers un chat partagé | Instantané en lecture seule, sans possibilité d’y poser une autre question. |

Le chat du projet reçoit aussi ses instructions permanentes. Tale applique les droits sur les fichiers : demander de lire un autre projet n’accorde pas cet accès. Les fichiers dans la corbeille ou dont la conservation a expiré ne sont pas consultables.

Utilise les [pièces jointes](/fr/platform/chat/attachments) pour cette conversation, les [fichiers du projet](/fr/platform/projects/manage-files) pour un travail récurrent et les [connaissances](/fr/platform/knowledge/overview) pour les références partagées. L’assistant récupère les contenus selon le besoin ; importer un document ne signifie pas que chaque réponse l’a utilisé.

## Vérifier ce que l’assistant a consulté

Au-dessus de la réponse, le déroulé montre les recherches et les lectures. Une étape en échec indique ce qui n’a pas pu être lu et aide à expliquer une réponse incomplète. Déplie la partie consacrée au raisonnement lorsqu’elle existe, mais vérifie les faits dans les sources plutôt que de te fier à la qualité de cette explication.

La zone **Sources** sous la réponse liste les documents et pages chargés. Ouvre une source et vérifie qu’elle appuie l’affirmation concernée. Une citation indique le contenu utilisé, sans garantir toutes les conclusions. Une réponse sans étape de consultation peut reposer sur les connaissances préalables du modèle.

L’assistant peut rechercher des documents, entrées de connaissances, sites, contacts, produits et tâches accessibles. Il peut lire le détail d’un résultat et une page web publique. Le chat n’exécute pas de code, ne modifie pas de systèmes connectés et ne produit pas de fichiers livrables. Confie ce travail à une [tâche de projet](/fr/platform/projects/tasks).

## Continuer ou conserver la conversation

La barre sous la réponse permet de copier le texte, donner un avis, consulter les détails ou créer une branche à cet endroit. Une branche permet d’explorer une autre direction tout en conservant l’échange précédent.

Retrouve les anciens chats dans [Accueil](/fr/platform#home) ; la vue **Chats**, au-dessus de la liste, n’affiche que les chats. Épingle ceux qui servent souvent, donne-leur un titre reconnaissable ou déplace-les dans un projet lorsque le sujet devient récurrent : fais-les glisser sur le projet ou choisis **Déplacer vers un projet…** dans leur menu. [Chats partagés](/fr/platform/chat/shared-threads) explique comment publier un instantané en lecture seule pour des collègues.

Une conversation très longue peut dépasser la fenêtre de contexte du modèle. Tale affiche un avis lorsque des messages anciens sont omis. Répète une contrainte importante ou démarre un nouveau chat avec les sources utiles, plutôt que de supposer que l’assistant voit encore tout l’historique.

## Améliorer une réponse incomplète

| Problème | Action |
| --- | --- |
| La réponse est trop générale | Pose une question, précise le public et indique la longueur ou le format souhaité. |
| Un fichier n’a pas été utilisé | Vérifie le projet du chat, l’indexation du fichier et les étapes de consultation. Nomme le fichier. |
| La recherche signale une source indisponible | Demande à un admin de vérifier le service indiqué ou la configuration d’embedding. Un résultat vide ne prouve pas que l’information n’existe pas. |
| Une réponse s’arrête sur une erreur | Lis l’erreur, vérifie le modèle choisi et réessaie après correction. Tale ne change pas de fournisseur en silence. |

Pour un exemple guidé avec vérification des sources, suis [Mieux dialoguer avec le chat](/fr/tutorials/member/chat-effectively).
