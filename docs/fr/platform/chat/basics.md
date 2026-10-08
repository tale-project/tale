---
title: Poser des questions dans le chat
description: Envoie un message, choisis un modèle, vérifie les sources et conserve les conversations utiles.
---

Utilise le chat pour poser une question, comprendre un document ou rechercher une information dans Tale. L’assistant peut parcourir les connaissances accessibles et lire des pages publiques. Commence par une question précise, puis affine la réponse avec des messages de suivi.

<Frame caption="Le chat conserve ta question, les étapes de l’assistant et sa réponse dans le même échange.">

![Un chat sur les retours d’onboarding affiche la question et une réponse qui présente trois thèmes dans un tableau.](/images/platform/chat-thread-reply.webp)

</Frame>

## Envoyer un premier message

Ouvre **Accueil**. Sur ordinateur, un nouveau chat s’ouvre, et le panneau latéral d’**Accueil**, à côté, liste tes chats précédents ; sur téléphone, choisis **Chats**, puis **Nouveau chat**. Pour aborder un autre sujet plus tard, choisis **Nouveau chat** ou, sur ordinateur, à nouveau **Accueil**. Écris dans le champ de message. Appuie sur **Entrée** pour envoyer ou sur **Maj+Entrée** pour aller à la ligne. Une suggestion de départ joue le même rôle que ta propre question : précise la source, le sujet et le type de réponse attendu.

Par exemple : « Retrouve les retours d’onboarding et résume les trois problèmes les plus fréquents. Cite les documents et sépare les problèmes signalés de tes suggestions. »

Si ton organisation a activé un avis de confidentialité, il s’affiche sous le champ de message pour te rappeler ce qu’il ne faut pas partager dans le chat.

Pendant la génération, la commande d’envoi devient une commande d’arrêt. L’arrêter conserve le texte déjà reçu, même s’il se termine au milieu d’une phrase. Pose une question de suivi pour clarifier la demande ou obtenir un détail manquant.

## Choisir un modèle lorsque c’est utile

Le sélecteur démarre sur **Auto** lorsque plusieurs modèles utilisables sont disponibles. Auto choisit un modèle pour chaque message parmi ceux de ton organisation. Les règles de l’organisation peuvent définir un choix par défaut ou restreindre les modèles autorisés. Les [détails sous la réponse](#reply-details) indiquent celui qui a effectivement répondu.

Choisis un modèle précis pour comparer des réponses dans les mêmes conditions ou lorsque tu sais lequel convient au travail. Il reste sélectionné jusqu’à ce que tu changes ce choix, y compris le fournisseur qui sert le modèle lorsque deux fournisseurs proposent le même. S’il permet de régler l’effort de raisonnement, le sélecteur propose aussi ce réglage. Un effort plus élevé peut prendre plus de temps ; il ne remplace pas la vérification du résultat.

<Frame caption="Le sélecteur de modèle se trouve à côté du menu des pièces jointes et des commandes vocales.">

![Le champ de message affiche le menu plus, le modèle Auto, un microphone et le bouton d’envoi.](/images/platform/chat-composer.webp)

</Frame>

Si aucun modèle n’est disponible, demande à un admin de vérifier les identifiants actifs des fournisseurs et les règles d’accès. Le chat ne propose que les modèles servis par des identifiants par clé API ou variable d’environnement : un abonnement ne fonctionne que dans les tâches et les automatisations, et la liste des modèles nomme les abonnements qu’elle laisse de côté. La page [Modèles](/fr/platform/models) explique la composition du catalogue.

## Fournir les bonnes sources

Choisis l’emplacement du chat avant de poser des questions sur des fichiers :

| Emplacement | Fichiers consultables par l’assistant |
| --- | --- |
| Chat général de l’organisation | Documents accessibles de la bibliothèque et pièces jointes propres au chat. |
| Chat dans un projet | Fichiers de ce projet, documents accessibles de la bibliothèque et pièces jointes du chat. |
| Lien vers un chat partagé | Instantané en lecture seule, sans possibilité d’y poser une autre question. |

Le chat du projet reçoit aussi ses instructions permanentes. Tale applique les droits sur les fichiers : demander de lire un autre projet n’accorde pas cet accès. Les fichiers dans la corbeille ou dont la conservation a expiré ne sont pas consultables.

Utilise les [pièces jointes](/fr/platform/chat/attachments) pour cette conversation, les [fichiers du projet](/fr/platform/projects/manage-files) pour un travail récurrent et les [connaissances](/fr/platform/knowledge/overview) pour les références partagées. L’assistant récupère les contenus selon le besoin ; importer un document ne signifie pas que chaque réponse l’a utilisé.

Les questions sur Tale lui-même ne demandent aucun envoi : l’assistant consulte la documentation publique sur docs.tale.dev avant d’expliquer un écran ou un réglage. Si le serveur ne peut pas joindre docs.tale.dev, par exemple sur une installation auto-hébergée sans accès à Internet, le déroulé affiche une lecture en échec et la réponse ne s’appuie pas sur la documentation. La documentation décrit la dernière version ; l’assistant signale quand ton espace de travail peut en différer.

## Vérifier ce que l’assistant a consulté

Au-dessus de la réponse, le déroulé montre les recherches et les lectures. Une étape en échec indique ce qui n’a pas pu être lu et aide à expliquer une réponse incomplète. Déplie la partie consacrée au raisonnement lorsqu’elle existe, mais vérifie les faits dans les sources plutôt que de te fier à la qualité de cette explication.

La zone **Sources** sous la réponse liste les documents et pages chargés. Ouvre une source et vérifie qu’elle appuie l’affirmation concernée. Une citation indique le contenu utilisé, sans garantir toutes les conclusions. Une réponse sans étape de consultation peut reposer sur les connaissances préalables du modèle.

L’assistant peut rechercher des documents, entrées de connaissances, sites, contacts, produits, tâches accessibles et conversations de la boîte de réception que tu peux voir, y compris le texte des e-mails qu’elles ont reçus et de leurs pièces jointes. Une tâche peut être désignée par sa clé, par exemple `DOCS-12`, telle que le tableau l’affiche. Il peut lire le détail d’un résultat et une page web publique. Le chat n’exécute pas de code, ne modifie pas de systèmes connectés, ne crée pas d’images, ne produit pas de fichiers livrables et n’utilise pas de [skills](/fr/platform/workspace/skills). Confie ce travail à une [tâche de projet](/fr/platform/projects/tasks). Toute personne qui peut ouvrir le projet peut en créer une et la confier à l’un des agents du projet ; [Transformer un chat en tâche](#create-task-from-chat) montre comment la créer depuis la conversation. Un agent de projet qui traite la tâche peut créer des images si un admin a activé la [génération d’images](/fr/platform/admin/governance/content-models#let-agents-generate-images).

## Voir comment une réponse a été produite {#reply-details}

Choisis **Afficher les informations** sous une réponse pour ouvrir **Informations sur le message**. Tu y trouves le modèle qui a répondu et son **Fournisseur IA**, la durée de la réponse et le nombre de tokens utilisés, ainsi que l’endroit où elle a été traitée lorsqu’il est connu.

- **Délai avant le premier token** indique le temps que le modèle a mis à commencer sa réponse, **Vitesse de sortie** la vitesse à laquelle il a écrit, en tokens par seconde, et **Durée totale** le temps de toute la réponse. La barre en dessous répartit ce temps entre la préparation, l’attente du modèle, la réflexion et la rédaction. Le serveur mesure à partir du moment où il a commencé la réponse ; le délai avant l’apparition des premiers mots sur ton écran, affiché sous la barre, peut donc être plus long.
- **Traité par** nomme l’entreprise qui a exécuté le modèle lorsque ton fournisseur transmet les requêtes à un autre. OpenRouter peut par exemple servir un même modèle Claude via Anthropic, Amazon Bedrock ou Google Vertex.
- **Région** indique où la réponse a été traitée, mais seulement si le fournisseur l’a indiqué, comme le fait Azure OpenAI (par exemple Switzerland North), ou si la requête est passée par un endpoint régional dont le fournisseur s’engage à traiter les requêtes dans une seule région, comme `eu.openrouter.ai` ou `eu.api.openai.com`. Sinon, elle affiche **Non indiquée** : Tale ne déduit pas un emplacement du nom ou du siège d’un fournisseur. Sur Azure, un déploiement de type Global peut traiter une requête dans n’importe quelle région, quelle que soit la région indiquée dans la réponse ; un déploiement Data Zone la traite dans sa zone de données, par exemple l’UE, et un déploiement régional dans sa zone géographique.
- **Version du modèle** apparaît lorsque le fournisseur indique un modèle plus précis que celui demandé, par exemple une version datée derrière un alias ou le modèle derrière un nom de déploiement Azure.

## Transformer un chat en tâche {#create-task-from-chat}

Quand une conversation aboutit à un travail qui demande un fichier, par exemple une présentation, un rapport ou un tableur, confie-le à un agent de projet. Sélectionne **Créer une tâche** dans l’en-tête de la conversation ; sur un écran étroit, choisis **Créer une tâche depuis le chat** dans le menu **⋯**. Si le chat est classé dans un projet, la tâche y est créée. Sinon, choisis d’abord le projet : **Avec un agent** liste les projets que tu peux ouvrir qui ont des agents, avec leur nombre. Un projet sans agents propres y figure avec **Agent standard** : sa tâche va à l’[agent standard](/fr/platform/projects/project-agents#standard-agent) de l’organisation. Quand l’agent standard ne peut pas fonctionner pour toi, par exemple parce qu’un Admin l’a désactivé, ces projets figurent plutôt sous **Sans agent pour l’instant**, chacun indiquant qui peut en ajouter un.

La boîte de dialogue de la tâche s’ouvre avec ta dernière demande comme description, un lien vers le chat et les fichiers que tu as joints dans la conversation. Si le projet a un seul agent, ou s’il utilise l’agent standard, celui-ci figure déjà sous **Assigné à** ; sinon, choisis-en un. Modifie ce que tu veux, puis sélectionne **Créer et démarrer l'agent** : la tâche est créée et l’agent s’y met aussitôt. **Créer seulement** la crée sans démarrer l’agent ; **Démarrer l'agent**, dans la tâche, le lance plus tard.

<Frame caption="Créer une tâche ouvre la boîte de dialogue de la tâche avec la demande, un lien vers le chat et l’agent à démarrer.">

![La boîte de dialogue de création de tâche contient comme titre et description « Plan the quarterly business review agenda for Friday », sous la demande un lien intitulé From the chat, Content editor comme agent assigné et les boutons Create only et Create and start agent.](/images/platform/chat-create-task.webp)

</Frame>

La tâche apparaît ensuite au-dessus du champ de message du chat, avec ce qu’elle fait en ce moment : **L’agent travaille**, **En attente d’une place de sandbox**, **Nouvelle tentative…**, **Prête pour la revue** avec le nombre de fichiers livrés, ou **L’agent n’a pas pu la terminer**. **Ouvrir** te mène à la tâche. Tu reçois aussi une notification quand elle est prête pour la revue et quand l’agent ne peut pas terminer ; [Quand l’agent ne peut pas terminer](/fr/platform/projects/task-automation#quand-lagent-ne-peut-pas-terminer) explique la suite.

<Frame caption="La tâche qu’un chat a confiée affiche sa progression au-dessus du champ de message.">

![Au-dessus du champ de message, une ligne nomme la tâche « Plan the quarterly business review agenda for Friday » avec Ready for review · Website relaunch et un lien Open.](/images/platform/chat-task-tray.webp)

</Frame>

Demande un tel fichier à l’assistant : il répond ce qui tient dans une réponse, puis te guide dans ces étapes pour tes propres projets, en nommant les boutons tels que tu les vois.

Aucun projet que tu peux ouvrir ne propose d’agent ? Alors l’agent standard ne peut pas fonctionner pour toi : un Admin l’a peut-être désactivé dans [Gouvernance > Modèles](/fr/platform/admin/governance/content-models#standard-agent), ou aucun modèle que tu peux utiliser ne peut le faire fonctionner. Demande à un Admin ce qu’il en est, ou demande à un Éditeur ou à un Admin d’ajouter un agent dans l’onglet **Agents** du projet. En tant qu’Éditeur, tu peux aussi en ajouter un depuis la tâche : sous **Assigné à**, choisis **Créer un agent…**.

Seuls les fichiers de ta propre conversation suivent. Une tâche n’accepte que les fichiers téléversés par la personne qui la crée ; une tâche créée depuis un chat qu’une autre personne a partagé dans un projet commence donc sans eux.

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
| Une réponse reste vide | La mention affichée à sa place en donne la raison : le modèle n’a rien renvoyé, il a épuisé sa limite de tokens en sortie avant d’écrire, ou le filtre de contenu du fournisseur a retenu la réponse. Choisis **Réessayer**, ou réduis d’abord l’effort de raisonnement, raccourcis la demande ou choisis un autre modèle. |

Pour un exemple guidé avec vérification des sources, suis [Mieux dialoguer avec le chat](/fr/tutorials/member/chat-effectively).
