---
title: Conversations
description: Conversations est l'inbox unifié pour tout ce qui arrive d'un canal client — messages Slack, e-mails, chats web, SMS. Les Éditeurs et Membres travaillent ici ; les agents trient et répondent ; les Administrateurs surveillent la santé de la file.
---

Conversations est l'inbox unifié de Tale. Chaque message de canal client qui atterrit — un DM Slack, un courriel entrant, une session de chat web, un SMS — surgit ici comme thread de conversation qu'un agent peut lire, répondre et router. Là où l'onglet Chat est l'endroit où un utilisateur interne parle à un agent, Conversations est l'endroit où le monde extérieur parle à l'org et aux agents qui y vivent. Les Éditeurs et Membres sont les opérateurs quotidiens de l'inbox ; les Administrateurs surveillent la file.

Cette section couvre ce qu'est une conversation, comment marchent routage et statut, comment un agent trie et répond, et comment l'inbox connecte aux Approbations et à la base de connaissances. La vue d'ensemble nomme les pièces et pointe vers les pages par pièce ; le modèle au niveau concept vit à un clic dedans.

## Ce qu'est une conversation

Une conversation est le thread que Tale construit autour d'un seul participant externe sur un seul canal. Elle porte chaque message échangé, chaque réponse d'agent, chaque décision de routage, chaque approbation qui s'est déclenchée pendant, et chaque lien vers la base de connaissances que l'agent a cité. La conversation est l'unité d'audit et l'unité de travail — la fermer termine le thread ; la rouvrir reprend là où on s'était arrêté.

Les conversations parcourent trois états de cycle de vie : **ouverte** (active, en attente d'action), **en pause** (parquée jusqu'à un rappel) et **fermée** (résolue). Chaque état filtre la vue inbox différemment ; le filtre par défaut est Ouverte, ce que veut voir un opérateur en s'asseyant à l'inbox.

## Canaux qui produisent des conversations

Les canaux qui alimentent Conversations sont les mêmes canaux listés sous [Intégrations](/fr/platform/integrations/overview) dans le groupe Communication : Slack, Microsoft Teams, Discord, Gmail, Outlook, IMAP/SMTP (toute boîte privée), Twilio (SMS et WhatsApp). Une intégration de canal installée route le trafic entrant vers l'inbox ; les règles de routage sous **Paramètres > Conversations** décident à quelle équipe ou agent atterrit chaque thread entrant.

Le canal chat web est intégré et ne demande pas d'intégration ; il apparaît comme widget intégrable que l'org peut déposer sur son propre site.

## Routage, statut et assignation

Chaque conversation a un assigné (une équipe, un agent, ou non assigné), un statut (ouverte, en pause, fermée) et une priorité optionnelle. Les règles de routage sous **Paramètres > Conversations** décident l'assigné initial basé sur le canal et le contenu du message ; l'assigné peut être réassigné à tout moment depuis la vue conversation.

Les agents dans le rôle assigné trient automatiquement — ils lisent le dernier message, décident s'ils peuvent répondre, et soit répondent directement, soit rendent la conversation à un humain. La passation est journalisée : l'historique de la conversation montre chaque décision d'agent à côté de chaque réponse humaine.

## Pages dans cette section

Cette section est courte — l'inbox est mécaniquement simple une fois le modèle clair. La page complète des concepts de conversation et les pages par fonctionnalité sont la couche suivante en dessous.

## Où cela s'inscrit

Conversations est le pendant de Chat : même pile agent-et-modèle dessous, audience différente dessus. La lecture suivante naturelle dépend du rôle — les Membres lisent [Chat](/fr/platform/chat/overview) pour la surface de conversation interne, les Éditeurs lisent [Concepts d'approbation](/fr/platform/approvals/concepts) pour comment l'inbox interagit avec la revue humaine, les Administrateurs lisent [Intégrations (vue Admin)](/fr/platform/admin/integrations) pour les identifiants de canal qui alimentent la file.
