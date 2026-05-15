---
title: Membre
description: Le siège consommateur en lecture seule — se connecter, discuter avec l'IA et les agents, parcourir la base de connaissances, lire les conversations et approbations partagées. L'orientation jour-un du Membre.
---

Un **Membre** dans Tale est le siège consommateur en lecture seule. Tu te connectes, discutes avec les modèles IA et les agents que ton équipe a mis en place, parcours la base de connaissances que tes Éditeurs curent, et lis les conversations et approbations partagées avec toi. Tu ne téléverses pas de documents, ne crées pas d'agents et ne changes aucun paramètre qui affecte les autres — ces surfaces sont réservées aux Éditeurs, Développeurs et Admins. Cette page est pour les personnes qui mettent les pieds dans Tale pour la première fois et pour quiconque n'a jamais besoin que du côté consommateur du produit.

Il n'y a rien à installer — Tale tourne entièrement dans le navigateur. S'il te faut aussi installer ou opérer une instance Tale toi-même, [Démarrage local](/fr/self-hosted/install/quickstart) et [Déploiement en production](/fr/self-hosted/install/linux-server) couvrent ça, et le reste de l'onglet auto-hébergé couvre l'exploitation de la plateforme.

## Une journée de Membre

Une journée typique commence sur l'écran d'accueil avec un chat tout neuf. Tu poses au modèle une question que l'équipe a documentée ; l'agent ramasse le document pertinent automatiquement et répond avec la citation liée au document d'origine. Plus tard, une Éditrice dépose un nouveau PDF produit dans la base de connaissances ; ta prochaine question sur ce produit tisse la nouvelle information dans la réponse sans que tu ne fasses rien. Si un coéquipier partage une conversation, elle apparaît sous **Conversations** ; si un workflow attend une décision humaine que ton rôle a le droit de voir, elle remonte sous **Approbations** (lecture seule — le verdict revient à un Éditeur).

## Se connecter

Ton Admin te fait entrer via l'une des trois méthodes, selon la configuration de ton organisation.

- **Courriel et mot de passe.** Ton Admin crée le compte depuis **Paramètres > Membres** avec un mot de passe initial et te le partage. Tu es obligé de le changer à la première connexion.
- **SSO (Microsoft Entra ID).** Tu te connectes avec ton compte Microsoft existant ; ton compte Tale est provisionné automatiquement la première fois.
- **Reverse-proxy (en-têtes de confiance).** Quand Tale est derrière Authelia, Authentik, oauth2-proxy ou similaire, le proxy t'authentifie et ton compte est auto-provisionné à la première requête.

Si tu ne peux pas te connecter, demande à ton Admin quelle méthode est active. Admins : voir [Authentification](/fr/self-hosted/admin/authentication) pour la configuration à l'échelle de l'instance.

## Ce que tu peux faire

### Discuter

Démarre une conversation depuis l'écran d'accueil. Choisis un modèle dans le sélecteur, tape un message et envoie. La saisie accepte aussi :

- Des pièces jointes — images, PDF, audio, vidéo. Voir [Pièces jointes de chat](/fr/platform/chat/attachments) pour la liste complète et le traitement par type.
- Une mention `@` d'un agent que ton Éditeur ou ton Développeur a publié. Voir [Agents dans le chat](/fr/platform/chat/agents-in-chat).
- Deux modèles côte à côte dans le [mode Arena](/fr/platform/chat/arena-mode) quand la question est « quel modèle répond le mieux ? ».

Référence complète : [Bases du chat](/fr/platform/chat/basics).

### Parcourir la base de connaissances

La base de connaissances tient les documents que ton organisation a téléversés ou crawlés. Tu peux la chercher, ouvrir des documents et les référencer depuis le chat. En tant que Membre, tu ne peux pas téléverser ni supprimer — c'est une tâche d'Éditeur. Voir [Base de connaissances](/fr/platform/workspace/knowledge-base).

### Lire les conversations et les approbations

- **[Conversations](/fr/platform/workspace/conversations)** — threads clients partagés avec toi. Lecture seule dans le rôle Membre ; les Éditeurs et au-dessus peuvent répondre.
- **[Approbations](/fr/platform/workspace/approvals)** — sorties d'automatisations qui attendent un verdict humain. Tu peux lire ; les Éditeurs et au-dessus décident.

## Personnaliser ton compte

Pose ton nom affiché, ta langue, ton thème et tes préférences de notification depuis le menu avatar. Les détails sont sur [Tes préférences](/fr/platform/member/preferences).

## Où cela s'insère

Les Membres sont les consommateurs en lecture seule — le siège conçu pour les personnes qui utilisent l'IA sans la curer. Pour créer des agents, modifier des connaissances ou faire tourner des automatisations, demande à un Admin de te faire monter en Éditeur ou Développeur. La matrice canonique des rôles vit sous [Membres et rôles](/fr/platform/admin/members-and-roles) ; les atterrissages spécifiques au rôle ([Éditeur](/fr/platform/editor/overview), [Développeur](/fr/platform/developer/overview)) décrivent ce que chaque montée débloque.
