---
title: Chatter efficacement
description: Cinq habitudes qui font passer un chat de « merci pour le pavé » à « exactement ce qu'il me fallait » — nommer l'agent, choisir le modèle, attacher le bon fichier, demander dans le périmètre et lire les citations.
---

Chatter efficacement dans Tale ne tient pas à des prompts astucieux ; il s'agit de donner au chat assez de contexte pour que le modèle saisisse ton intention dès la première lecture. Cinq petites habitudes — choisir le bon agent, choisir le bon modèle, n'attacher que ce qui compte, demander dans le périmètre, lire les citations — font passer la réponse moyenne de « merci pour le pavé » à « exactement ce qu'il me fallait ». Cette page déroule les habitudes dans l'ordre sur un chat neuf.

Il te faut un rôle Membre (le plancher pour le chat) et un agent publié dans l'organisation que tu peux adresser. Le côté conceptuel vit dans [Bases du chat](/fr/platform/chat/basics) ; ce parcours est le mécanisme quotidien.

## Habitude 1 — Choisir l'agent avant le premier message

L'agent est le levier au plus fort rendement par clic. L'Assistant par défaut est une toile blanche ; un agent avec du savoir lié, des tools actifs et une voix réglée le battra sur toute question non générique. Ouvre le sélecteur d'agent dans le chat et choisis l'agent dont le périmètre correspond à ta question — Support, Sales, Research — avant de taper.

Si aucun agent ne convient, laisse l'Assistant ; ne va pas vers un agent mal ajusté pour « ça ira ». Un agent mal ajusté refuse souvent ou s'écarte du savoir lié.

## Habitude 2 — Choisir le modèle adapté au message

Le sélecteur de modèle à côté du sélecteur d'agent liste tous les modèles qu’exposent les identifiants de fournisseur de l’organisation, groupés en **Modèles** et **Agents sandbox**. Rien n’est choisi à ta place, alors change dès que le message change de forme. Une longue question de raisonnement veut un modèle plus grand ; une recherche rapide veut un modèle plus petit et plus rapide. Un message avec une image a besoin d'un modèle capable de vision — sans cela, l'image est silencieusement abandonnée.

Le sélecteur de modèle affiche le tag (`Chat`, `Vision`, `Image`, `Embedding`) à côté de chaque nom ; fais correspondre le tag au message.

## Habitude 3 — N'attacher que ce dont l'agent a besoin

Les pièces jointes invitent à l'excès. Un PDF de 200 pages en pièce jointe unique remplit le budget de contexte et dilue la réponse ; les pages pertinentes extraites dans le prompt battent le fichier entier. Si tu attaches un document long, pose-lui une question précise (« que dit la page 12 sur les remboursements ? ») plutôt qu'une question ouverte (« raconte-moi tout »).

Pour les fichiers que tu référenceras souvent — une liste de prix, un document de politique — charge-les dans la section [Savoir](/fr/platform/knowledge/documents) et lie-les à un agent. Une fois liés, chaque chat avec cet agent les a sous la main sans nouveau chargement.

## Habitude 4 — Demander dans le périmètre de l'agent

Chaque agent a un périmètre implicite issu de ses instructions et de son savoir lié. Demander à un agent billing une stratégie marketing donne au mieux un refus poli, au pire une hallucination. Le correctif bon marché : lis la bio de l'agent en haut du sélecteur avant de demander — elle nomme le périmètre. Si ta question est hors périmètre, change d'agent.

## Habitude 5 — Lire les citations et les suivre

Quand la réponse contient des citations (les petits liens en ligne), ouvres-en une. La citation pointe sur le chunk de la source que l'agent a cité ; la lire confirme que l'agent n'a pas paraphrasé au-delà de ce que la source dit vraiment. La petite habitude de deux minutes d'ouvrir une citation par réponse attrape la petite portion de réponses où l'agent a dépassé.

## Où ça s'utilise

Cinq habitudes, un chat, la même boucle à chaque ouverture de l'onglet Chat. Les habitudes se renforcent — le bon agent rend le bon modèle évident ; le bon modèle rend les citations fiables ; les citations bouclent la boucle.

Pour la surface sur laquelle ces habitudes vivent, voir [Bases du chat](/fr/platform/chat/basics). Pour le côté fichiers — ce qui est collé tel quel, ce qui est indexé — voir [Pièces jointes](/fr/platform/chat/attachments).
