---
title: Conversations
description: Gère les conversations clients depuis une boîte de réception unifiée.
---

Conversations est la boîte de réception client. Quand les clients contactent ton équipe via un canal connecté, par exemple l’email, leurs messages apparaissent ici comme des fils. Ton équipe peut lire, répondre, fermer et gérer depuis cette vue unique.

Les connexions de canaux sont mises en place une fois par un Développeur dans [Intégrations — aperçu](/fr/platform/integrations/overview) — l’intégration email alimente cette boîte.

## Statuts de conversation

| Statut   | Signification                                               |
| -------- | ----------------------------------------------------------- |
| Ouverte  | conversation active qui attend une réponse ou est en cours. |
| Fermée   | conversation résolue et marquée comme terminée.             |
| Spam     | messages marqués comme non sollicités ou non pertinents.    |
| Archivée | conservée en référence mais retirée de la boîte active.     |

## Répondre

1. Clique une conversation pour l’ouvrir dans le panneau de droite.
2. Le composeur se charge en bas. C’est un éditeur rich-text qui supporte gras, italique, listes, liens et blocs de code.
3. Écris ta réponse. Tu peux joindre des fichiers avec l’icône trombone.
4. Utilise le bouton **Améliorer avec l’IA** (si activé) pour que l’IA nettoie ton message avant envoi.
5. Clique **Envoyer**. Le message part par le canal utilisé par le client.

## Actions en masse

Sélectionne plusieurs conversations via la case à cocher en tête de liste. Actions disponibles :

- changer de statut : fermer, rouvrir, archiver ou marquer comme spam ;
- envoyer un message à tous les destinataires sélectionnés en une fois.

## Filtrer

Utilise le menu de filtres dans la barre d'outils pour afficher les conversations lues ou non lues. Cela fait ressortir ce qui demande encore de l'attention sans faire défiler tout l'inbox.

## Où cela s'insère

Conversations est l'inbox partagé de Tale pour les canaux côté client — courriel, chat et vocal. Il existe parce que le travail de réponse aux clients ne tient pas dans le chat IA : les réponses ont besoin d'un humain dans la boucle, d'un fil unique par client à travers les canaux, et d'un historique auditable. L'agent qui assure le côté IA est le même que celui que le reste de l'espace de travail utilise ; ce qui change, c'est la surface.

Pour la configuration côté agent qui décide quelles conversations reçoivent des brouillons de réponse automatiques, voir [Concepts des agents](/fr/platform/agents/concepts) et [Créer un agent](/fr/platform/agents/create). Pour les approbations qui sortent d'un fil client (un brouillon de réponse en attente de relecture, un appel d'intégration en attente de feu vert), [Approbations](/fr/platform/workspace/approvals) est la surface.
