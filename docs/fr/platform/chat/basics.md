---
title: Bases du chat
description: Ce qui se passe entre l’envoi et l’arrivée de la réponse — les choix de la zone de saisie, ce que le modèle reçoit, le streaming, et la façon dont un chat est stocké.
---

Cette page est le modèle mental de tout l’onglet Chat. Elle nomme les parties de l’écran, suit un message de la frappe jusqu’à la réponse en streaming, dit exactement ce que le modèle reçoit au passage, et explique comment un chat est stocké une fois arrivé. Lis-la une fois et les autres pages du chat se liront comme des variations du même parcours.

<Frame caption="L’onglet Chat avec une réponse en streaming au-dessus de la zone de saisie.">

![Un fil de chat montrant une question d’utilisateur sur des retours d’onboarding et une réponse de l’assistant contenant un tableau markdown de trois thèmes.](/images/platform/chat-thread-reply.webp)

</Frame>

## La zone de saisie

La zone de saisie est la bande en bas de l’écran. Trois contrôles décident de ce qui revient : le sélecteur d’agents, le sélecteur de modèles à côté, et le champ de message avec le bouton d’envoi. Les pièces jointes arrivent par collage, glisser-déposer ou le contrôle d’ajout — [Pièces jointes](/fr/platform/chat/attachments) détaille ce qui est accepté et où atterrit un envoi.

Deux de ces trois contrôles sont des choix que tu poses toi-même, et aucun n’a de valeur par défaut qui réfléchit à ta place. Le sélecteur montre ce qui va tourner ; ce qu’il montre est ce qui tourne.

## Choisir un agent

Le sélecteur d’agents filtre par nom pendant que tu tapes et liste les agents auxquels tu as accès qui sont visibles dans le chat. Un agent porte un nom, une description, ses instructions, une visibilité, les tools et skills qu’il peut appeler, et la portée de connaissance qu’il peut atteindre — [Agents dans le chat](/fr/platform/chat/agents-in-chat) couvre les règles en détail.

Changer d’agent en cours de chat ne coupe pas la conversation. Le message suivant part vers l’agent désormais nommé dans le sélecteur, et cet agent lit tout ce qui précède.

## Choisir un modèle

C’est toujours toi qui nommes le modèle. Il n’y a pas de routage automatique, pas de score de complexité qui tranche à ta place, et pas de chaîne qui glisse discrètement un autre modèle quand le premier traîne — la réponse devant toi vient de l’entrée que tu as choisie, à chaque fois.

Le sélecteur range ses entrées en deux groupes :

- **Modèles** — les modèles que la plateforme appelle directement via sa propre boucle de chat. C’est le chemin ordinaire : la plateforme assemble le contexte, streame la réponse et exécute les appels de tools.
- **Agents Sandbox** — les modèles qui tournent dans un harness d’agent de code, en Sandbox, plutôt que dans la boucle de chat. Un harness est un agent en ligne de commande avec ses propres tools de fichiers et sa propre boucle ; la plateforme le démarre, lui passe le prompt et rediffuse sa sortie dans le chat.

Un modèle du premier groupe peut lui aussi partir en Sandbox : active l’exécution en Sandbox pour ce tour et le modèle tournera sous un harness plutôt que dans la boucle directe. Le harness est prérempli avec celui du fournisseur concerné et peut être remplacé par un autre.

<Note>

Certains identifiants tranchent à ta place. Un identifiant d’abonnement fournisseur ne fonctionne que dans l’agent en ligne de commande de ce même fournisseur — un abonnement Anthropic, par exemple, ne tourne que sous le harness `claude-code`. Pour ces identifiants, l’exécution en Sandbox est activée et verrouillée, et demander un autre harness est refusé avec un motif plutôt que redirigé en silence.

</Note>

## Ce que le modèle reçoit

Le prompt est assemblé dans un ordre fixe, et la liste est courte par choix : les instructions obligatoires de l’organisation, les instructions de l’agent, les règles de traitement des contenus non fiables, une courte ligne de documentation par tool disponible, puis l’horodatage courant avec la consigne de langue de réponse, et enfin l’historique complet des messages — y compris les messages de tools, les cartes d’approbation et les cartes de question, les pièces jointes voyageant comme parties de contenu.

Rien d’autre ne s’y ajoute. Pas de bloc de personnalisation, pas de mémoires glissées dans ton dos, pas de récupération automatique de connaissance, pas de contexte web automatique, et aucun texte de marque ou de réglage accroché à tes instructions. Tout ce que le modèle apprend au-delà de ses instructions, il l’apprend en appelant quelque chose — ce qui le rend visible dans la transcription, attribuable et refusable.

<Info>

Quand la conversation dépasse la fenêtre de contexte du modèle, les messages les plus anciens sont retirés et un avis visible prend leur place. Ils ne sont pas résumés : un résumé serait un second appel de modèle capable d’inventer l’historique qu’il devait préserver, alors que retirer des messages perd de l’information d’une façon que tu peux voir.

</Info>

## Ce que le modèle peut appeler

Les tools intégrés, les actions d’connector, les skills, les automatisations et les tools des serveurs MCP connectés vivent dans un seul registre derrière un seul répartiteur. Le modèle cherche dans cette surface et invoque une entrée par son identifiant, si bien que les automatisations de ton organisation sont aussi trouvables que les tools intégrés. Avant chaque appel, l’entrée est validée contre son schéma.

La récupération de connaissance est délibérément un appel distinct plutôt qu’un résultat de recherche de plus : trouver un fait et trouver un tool sont deux questions différentes. Une automatisation qui ne démarre que sur un événement figure dans la liste avec cette mention, et l’invoquer est refusé avec une explication au lieu d’être masqué.

## Lire la réponse

La réponse arrive en streaming à mesure qu’elle se génère. Quand le modèle réfléchit avant de répondre, une ligne de raisonnement repliable apparaît au-dessus. Les appels de tools se rendent en cartes repliées que tu peux ouvrir pour lire ce qui a tourné et ce qui est revenu ; le code exécuté envoie sa sortie dans le Canvas, à droite. Quand le modèle récupère de la connaissance, des citations s’accrochent aux phrases qu’elles soutiennent — le survol montre la source, le clic l’ouvre. Les instructions de l’agent n’apparaissent jamais dans la réponse rendue : elles sont une couche en dessous et façonnent le comportement plutôt que le texte.

## Les questions de l’agent

Un agent doté du tool de question humaine peut s’arrêter en pleine tâche et te demander quelque chose. Une carte de question apparaît dans le chat avec les champs dont l’agent a besoin, et la génération attend ta réponse. Remplis le formulaire et envoie-le, ou réponds en texte libre si le formulaire n’a pas la bonne forme pour ce que tu veux dire. Si ta réponse était fausse ou incomplète, rouvre la carte déjà répondue : le formulaire revient prérempli, et le renvoyer relance l’agent avec la réponse corrigée qui remplace l’ancienne. La carte garde chaque réponse précédente, donc tu peux feuilleter les versions comme pour les messages modifiés.

## Conversations versus chats

Dans Chat, l’unité est un **chat** — c’est le mot qu’emploient tous les boutons et toutes les notifications. Le modèle de données derrière s’appelle `threads` et l’URL porte `threads/$threadId` ; la doc suit l’interface et dit « chat » dans le corps du texte. La boîte de réception d’un canal de contact, ajoutée par une automatisation e-mail installée, est une autre surface : une conversation là-bas est un fil de contact, pas un chat — voir [Automatisations fournies](/fr/platform/automations/builtin) pour ce sens-là.

## Historique et recherche

La barre latérale d’historique liste chaque chat que tu peux reprendre dans cette organisation, du plus récent au plus ancien ; en sélectionner un ouvre la transcription complète. La recherche y filtre par titre, et la recherche plein texte dans le corps des messages se fait chat par chat plutôt qu’à l’échelle de l’organisation. Renommer un chat pose un titre à toi qui remplace celui généré. Supprimer un chat le déplace vers la [Corbeille](/fr/platform/admin/governance/trash), où la rétention le balaie après le délai de grâce.

## Où cela s’inscrit

Bases du chat est la page que le reste de cette section affine : [Agents dans le chat](/fr/platform/chat/agents-in-chat) creuse le sélecteur et le changement en cours de route, [Pièces jointes](/fr/platform/chat/attachments) ce que devient un envoi, [Mode vocal](/fr/platform/chat/voice-mode) le fait de parler plutôt que taper, et [Volet Canvas](/fr/platform/chat/canvas-pane) l’endroit où atterrissent les sorties longues. Si tu es venu construire un agent plutôt qu’en utiliser un, [Concepts d’agent](/fr/platform/agents/concepts) est la suite — la forme d’un agent est ce sur quoi repose chaque chat avec un agent.
