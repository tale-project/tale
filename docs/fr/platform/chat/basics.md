---
title: Bases du chat
description: Ce qui se passe entre l’envoi et l’arrivée de la réponse — les choix de la zone de saisie, ce que le modèle reçoit, les trois outils de récupération, et comment lire le déroulé de réflexion et les sources.
---

Cette page est le modèle mental de tout l’onglet Chat. Elle nomme les parties de la zone de saisie, suit un message de la frappe jusqu’à la réponse en streaming, dit exactement ce que le modèle reçoit et ce qu’il a le droit d’appeler en chemin, et montre comment lire ce qui est revenu. Lis-la une fois et les autres pages du chat se liront comme des variations du même parcours.

<Frame caption="L’onglet Chat avec une réponse en streaming au-dessus de la zone de saisie.">

![Un fil de chat montrant une question d’utilisateur sur des retours d’onboarding et une réponse de l’assistant contenant un tableau markdown de trois thèmes.](/images/platform/chat-thread-reply.webp)

</Frame>

## La zone de saisie

La zone de saisie est la bande en bas de l’écran. Le champ de message envoie sur **Entrée** et va à la ligne sur **Maj+Entrée**. Un seul sélecteur, à côté du menu `+`, porte le choix du modèle — **Auto**, le défaut, laisse Tale choisir un modèle par message, ou tu en nommes un — et, pour un modèle nommé qui l’expose, l’effort de raisonnement. C’est là, à dessein, tout l’éventail des choix : pas de sélecteur d’agent, pas de sélecteur de skills, aucun contrôle sur l’endroit où le tour s’exécute. Le menu `+` porte **Ajouter photos et fichiers** et, quand un chat peut l’accueillir, le **Mode Arène** ([Mode Arène](/fr/platform/chat/arena-mode)) ; **Lire les réponses à voix haute** ([Mode vocal](/fr/platform/chat/voice-mode)) est l’interrupteur haut-parleur à côté du micro, et le micro dicte dans le champ.

Pendant qu’une réponse arrive en streaming, le bouton d’envoi devient un bouton d’arrêt. Arrêter garde tout ce qui a déjà été diffusé — la réponse reste telle quelle, au milieu d’une phrase si c’est là qu’elle en était.

### Pièces jointes

Glisse des fichiers depuis ton bureau n’importe où sur la zone de saisie — un bandeau dit **Dépose les fichiers ici pour téléverser** pendant le survol —, colle une capture d’écran directement dans le champ de message, ou choisis des fichiers via **Ajouter photos et fichiers** dans le menu `+`. Le chat accepte les images, les documents (PDF, Office, OpenDocument, CSV), les fichiers texte et l’audio/vidéo. Chaque image se pose en petite miniature au-dessus du champ : un clic l’agrandit, son ✕ la retire. Le reste se pose en puce nommée qui suit son traitement : le modèle de transcription de ton organisation transforme l’audio et la vidéo en texte, et les documents sont indexés pour la récupération. L’envoi n’attend jamais une barre de progression — un message envoyé pendant que des fichiers se traitent encore se gare au-dessus de la zone de saisie et part tout seul dès que tout est prêt ; son ✕ abandonne l’envoi en attente et remet le texte dans le champ. Jusqu’à dix fichiers voyagent avec un message.

Colle un lien vidéo (YouTube, Vimeo, Bilibili et compagnie) et il devient une puce lui aussi : Tale récupère les sous-titres en arrière-plan — ou extrait et transcrit la piste audio quand il n’y en a pas — et la transcription voyage avec ton message comme un enregistrement téléversé. Seule une puce vidéo en échec retient l’envoi, parce que l’attendre ne finirait jamais : relance-la ou retire-la, tout le reste se met en file.

Un modèle qui sait voir les images reçoit les pixels eux-mêmes, au fil de tes mots ; pour un modèle qui ne le sait pas, la zone de saisie le dit dès l’attache — ce modèle ne verrait que les noms de fichier. L’audio n’atteint jamais le modèle de chat en octets : le modèle reçoit la transcription en texte, tandis que ta bulle garde les mots que tu as tapés (et la puce audio). Le contenu d’un document parvient à l’assistant par ses outils de connaissances — le tour lui nomme les fichiers joints et il les lit avec `rag_fetch` ; attends-toi donc à une étape de récupération avant la réponse. Un format sans extracteur de texte (anciens fichiers Office comme `.doc`) s’attache quand même, mais l’assistant n’en voit que le nom — et le dit au lieu de deviner.

Les documents déposés ici restent privés dans cette conversation — ils ne rejoignent jamais la [Base de connaissances](/fr/platform/knowledge/overview) de l’organisation, et aucun autre chat ni collègue ne peut les récupérer. Les fichiers attachés appartiennent au chat où tu les as posés (changer de chat les efface), et régénérer une réponse renvoie les mêmes pièces jointes — transcriptions et accès aux documents sont reconstruits pour le modèle depuis les fichiers stockés. Le travail qui produit des fichiers revient à une tâche. Parler dans le micro est un autre chemin — voir [Mode vocal](/fr/platform/chat/voice-mode).

<Frame caption="La zone de saisie : le champ de message, le sélecteur de modèle et d’effort, la dictée, l’envoi.">

![La zone de saisie du chat avec son menu plus, le sélecteur de modèle affichant Auto, le bouton micro et le bouton d’envoi.](/images/platform/chat-composer.webp)

</Frame>

## Choisir un modèle

Le sélecteur s’ouvre sur **Auto** : pour chaque message, Tale lit ce que tu as écrit — longueur, code, sujet — et lui choisit un modèle dans la même liste que montre le sélecteur : un modèle léger pour la question rapide, un modèle fort pour le terrain difficile ou sensible. Un document joint relève le plancher : un message qui porte un fichier à lire ne part jamais sur le modèle le plus léger, aussi courte que soit la question. Aucune seconde IA ne tranche (c’est une heuristique toute simple sur le message), et il n’y a jamais de bascule silencieuse : le modèle qui commence ta réponse est celui qui la termine, et les détails du message le nomment. Dès qu’un message porte des images, seuls les modèles capables de les voir entrent en jeu ; si aucun ne le peut, l’envoi le dit au lieu de deviner.

Tu préfères décider ? Choisis un modèle dans la liste — le sélecteur liste les modèles pour lesquels l’organisation détient un identifiant actif et directement utilisable ; un modèle qui ne pourrait tourner que dans l’outillage propre d’un fournisseur n’est pas proposé ici. Un choix nommé reste le tien jusqu’à ce que tu le rendes à Auto, et l’un comme l’autre reste le défaut de tes prochains chats. Auto n’apparaît que s’il y a un vrai choix à faire — avec un seul modèle utilisable, le sélecteur le nomme, tout simplement.

Pour les modèles à profondeur de raisonnement réglable, la deuxième section du sélecteur fixe l’effort. Ce choix accompagne la conversation — chaque tour suivant tourne au niveau que tu as posé, et les modèles sans ce réglage l’ignorent. Laissé sur **Par défaut**, un modèle qui sait répondre sans raisonnement étendu répond ainsi — pose un niveau quand tu veux qu’il réfléchisse plus longtemps. Sur Auto, la section d’effort reste hors du menu : l’intensité de réflexion va de pair avec _quel_ modèle tourne — épingle-en un pour la régler.

## Ce que le modèle reçoit

Le prompt est assemblé dans un ordre fixe, et la liste est courte par choix : les instructions obligatoires de l’organisation, le guide intégré de l’assistant, les règles de traitement des contenus non fiables, une courte ligne de documentation par outil, puis l’horodatage courant avec la consigne de langue de réponse, et enfin l’historique complet des messages — chaque appel d’outil et son résultat compris, exactement comme ils se sont produits.

Rien d’autre ne s’y ajoute. Pas de bloc de personnalisation, pas de mémoires glissées dans ton dos, pas de récupération automatique de connaissances, pas de contexte web automatique. Tout ce que le modèle apprend au-delà de ses instructions, il l’apprend en appelant un outil — l’appel apparaît donc dans la transcription, attribuable et refusable.

<Info>

Quand la conversation dépasse la fenêtre de contexte du modèle, les messages les plus anciens sont retirés et un avis visible prend leur place. Ils ne sont pas résumés : un résumé serait un second appel de modèle capable d’inventer l’historique qu’il devait préserver, alors que retirer des messages perd de l’information d’une façon que tu peux voir.

</Info>

## Les trois outils

L’assistant porte exactement trois outils, tous tournés vers la récupération et tous en lecture seule — c’est la frontière qui fait du chat une conversation plutôt qu’un établi.

| Outil        | Ce qu’il atteint                                                                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rag_search` | Les connaissances de l’organisation et son travail : documents, entrées de connaissances, pages de sites web explorés, produits, contacts, sites web, tâches et projets — et les conversations de la boîte de réception |
| `rag_fetch`  | Le détail derrière une référence — un document par son identifiant de fichier, une page explorée par son URL, une tâche par la référence issue d’une recherche                                                          |
| `web_fetch`  | Une page web publique, récupérée en direct — l’étape au-delà des connaissances de l’organisation ; le contenu déjà exploré passe par `rag_fetch`                                                                        |

Interroger le tableau — ce qui est ouvert sur un projet, par exemple — relève de la recherche, pas d’une autre fonctionnalité. La même `rag_search` lit les tâches et les projets que tu peux voir, filtrés selon ton propre accès, et l’assistant répond à partir de là plutôt que de proposer un outil externe. Un résultat de tâche porte son titre, son statut et son projet ; `rag_fetch` sur sa référence ajoute la description complète, les commentaires, les sous-tâches et les bloqueurs.

Parcourir, c’est le même outil avec son second verbe. « Liste les tâches en revue » ou « montre nos contacts » fait tourner `rag_search` en listage explicite plutôt qu’en correspondance de texte : une seule sorte par appel, le tableau courant sans les lignes archivées, au plus vingt lignes par page. L’assistant sait quand une page n’est pas l’ensemble complet — il va chercher la page suivante ou dit quelle partie il a vue, au lieu de présenter vingt lignes comme le tout.

Une recherche est honnête sur ce qu’elle a couvert : le résultat nomme chaque source interrogée et dit lesquelles étaient indisponibles — une organisation sans modèle d’embedding configuré reçoit par exemple « les documents et les pages explorées ne peuvent pas encore être cherchés » plutôt qu’une liste vide et muette, et l’assistant relaie ce constat au lieu de deviner autour.

Il n’y a délibérément rien d’autre — pas d’exécution de code, pas d’écriture de fichiers, pas de connectors, pas de sous-agents. Ces capacités vivent sur les tâches et dans les automatisations, là où existent un responsable, une étape de relecture et une piste d’audit à leur mesure.

## Demander un livrable

Demande à l’assistant une présentation, un document traduit ou n’importe quel autre artefact : il n’en bâtira pas une moitié dans le fil. Il te donne la version courte si elle est utile, puis te dit de créer une tâche et de l’assigner à un agent. Une tâche a un responsable, produit un résultat à relire, et seule une personne la marque Terminé — rien de tout cela n’est à la portée d’une réponse de chat. Traduire une phrase que tu as collée est un travail de chat ; traduire un fichier est un travail de tâche.

## Lire la réponse

La réponse arrive en streaming à mesure qu’elle se génère. Au-dessus d’elle, le déroulé de réflexion consigne ce que l’assistant a fait, dans l’ordre :

- Une ligne repliable **« A réfléchi pendant _n_ s »** porte le raisonnement du modèle — clique pour déplier la prose.
- Chaque appel d’outil est une ligne d’étape — _Recherche de « … » dans l’espace de travail_, _Liste des tâches_, _Lecture de example.com_ — avec un indicateur d’activité pendant qu’il tourne et, quand il échoue, un avertissement qui en donne la raison. Les étapes restent visibles quand le raisonnement est replié ; elles sont la trace de ce que l’assistant est allé chercher.

Sous la réponse, **Sources** liste les pages et les documents que l’assistant a réellement chargés — la liste dérive des résultats d’outils, pas de la prose, si bien qu’une carte de source ne revendique jamais une lecture qui n’a pas eu lieu. Les sources web s’ouvrent dans un nouvel onglet.

La barre d’outils sous une réponse posée copie le texte, montre les comptes de tokens et les durées (**Envoyer → premiers mots** depuis Envoyer ; **Début → fin** et **Début → premier token** depuis le démarrage de la réponse sur le serveur), recueille un avis pouce levé ou baissé, et duplique le chat — une copie visible de la conversation jusque-là, poursuivie comme un chat à part entière.

## Conversations versus chats

Dans Chat, l’unité est un **chat** — c’est le mot qu’emploient tous les boutons et toutes les notifications. Le modèle de données derrière s’appelle `threads` et l’URL porte `threads/$threadId` ; la doc suit l’interface et dit « chat » dans le corps du texte. La boîte de réception de canaux de contact qu’ajoute une automatisation e-mail installée est une autre surface : une conversation là-bas est un fil de contact, pas un chat — voir [Automatisations fournies](/fr/platform/automations/builtin) pour ce sens-là.

## Historique et recherche

La barre latérale d’historique liste chaque chat que tu peux reprendre dans cette organisation, du plus récent au plus ancien, tes chats épinglés en tête et les chats rangés dans un projet sous leurs dossiers ; en sélectionner un ouvre la transcription complète. La recherche y filtre par titre, et la recherche plein texte dans le corps des messages se fait chat par chat plutôt qu’à l’échelle de l’organisation. Renommer un chat pose un titre à toi qui remplace celui généré. Supprimer un chat le déplace vers la [Corbeille](/fr/platform/admin/governance/trash), où la rétention le balaie après le délai de grâce.

## Où cela s’inscrit

Bases du chat est la page que le reste de cette section affine : le [Mode Arène](/fr/platform/chat/arena-mode) fait tourner un même prompt sur deux modèles côte à côte, le [Mode vocal](/fr/platform/chat/voice-mode) couvre le fait de parler plutôt que de taper, et les [Chats partagés](/fr/platform/chat/shared-threads) la publication d’une transcription à l’organisation. Si ta question s’est changée en travail — quelque chose qui finit sur un livrable — [Concepts d’agent](/fr/platform/agents/concepts) est la lecture suivante : sur les tâches, les agents font tout ce que le chat laisse délibérément de côté.
