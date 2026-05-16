---
title: Conversations
description: La boîte de réception client partagée — les fils de courriel arrivent ici, l'équipe répond, et l'IA aide aux brouillons, au tri et aux suivis.
---

Conversations est la boîte de réception partagée pour les canaux côté client. Quand un message arrive via un canal connecté — aujourd'hui une boîte courriel, plus de canaux à venir — il apparaît ici comme un fil ; l'équipe lit, répond, ferme et audite sans quitter la plateforme. La page s'adresse aux Éditeurs qui gèrent le trafic entrant et aux Admins qui configurent les connexions de canaux ; les Membres voient la boîte en lecture seule quand leur rôle le permet.

Cette page couvre l'exécution : connecter un canal courriel, les quatre statuts de fil, le composeur de réponse avec amélioration IA, les actions en masse et le filtrage. Le côté agent — comment un agent rédige un brouillon, quand une carte d'approbation apparaît — vit dans le flux de construction d'agent à [Créer un agent](/fr/platform/agents/create).

## Connecter un canal courriel

Pour qu'une boîte mail alimente la boîte de réception, un Admin ou un Développeur l'ajoute une fois dans **Paramètres > Intégrations**. La page Conversations vide met en avant un bouton **Connecter le courriel** qui saute droit sur l'onglet d'intégrations. La connexion n'est pas un connecteur générique `rest_api` — le courriel a sa propre surface de configuration, calibrée pour les identifiants IMAP+SMTP et les flux OAuth des grands fournisseurs de messagerie.

Pour les fournisseurs de courriel OAuth (Microsoft 365, Gmail), utilise le flux OAuth dédié sur la carte d'intégration du fournisseur — l'IMAP par mot de passe est désactivé par défaut chez ces fournisseurs. Pour les boîtes IMAP+SMTP auto-hébergées ou génériques, remplis directement les champs de connexion :

| Champ              | Ce qu'il faut mettre                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Nom affiché        | Le nom montré sur les conversations issues de cette boîte.                                        |
| Entrant (IMAP)     | Hôte, port, chiffrement (`SSL/TLS`, `STARTTLS` ou `None`), identifiant, mot de passe.             |
| Sortant (SMTP)     | Hôte, port, chiffrement, identifiant, mot de passe (souvent les mêmes identifiants qu'IMAP).      |
| Adresse expéditeur | L'adresse depuis laquelle les réponses sont envoyées. Doit correspondre à ce que le SMTP accepte. |
| Intervalle de sync | Fréquence à laquelle Tale relève le courrier (par défaut une minute).                             |

Après enregistrement, Tale relève la boîte à l'intervalle configuré. Le courrier entrant devient des fils Conversations — chaque chaîne unique de réponses forme un fil ; les réponses envoyées depuis la plateforme sortent comme des courriels normaux via SMTP et reviennent dans le client mail du client via les en-têtes `In-Reply-To` standards. La boîte reste liée jusqu'à ce que l'intégration soit retirée ; la supprimer arrête la synchronisation mais conserve les fils déjà en boîte.

## Statuts de fil

Chaque fil porte un statut parmi quatre, réglable depuis l'en-tête de la conversation ou via les actions en masse :

| Statut  | Signification                                                               |
| ------- | --------------------------------------------------------------------------- |
| Ouvert  | Fil actif qui attend une réponse ou est en cours.                           |
| Fermé   | Résolu et marqué comme terminé. Les fils fermés restent cherchables.        |
| Spam    | Marqué comme non sollicité ou non pertinent. Masqué de la liste par défaut. |
| Archivé | Conservé en référence mais retiré de la boîte active.                       |

Un nouveau message entrant sur un fil Fermé ou Archivé le rouvre automatiquement — le suivi du client ne se perd pas derrière un drapeau de statut.

## Répondre à une conversation

Pour répondre, ouvre la conversation depuis la liste — le composeur se charge en bas du panneau de droite. Le composeur est un éditeur rich-text avec gras, italique, listes, liens et blocs de code. Clique sur l'icône trombone dans la barre d'outils pour attacher un logo, une capture ou un document depuis l'appareil. Pour que l'IA resserre le brouillon avant l'envoi, clique sur **Améliorer avec l'IA** si l'agent l'a activé ; l'IA réécrit le brouillon dans un panneau d'aperçu et tu acceptes ou refuses les modifications avant d'envoyer.

Clique sur **Envoyer** pour livrer le message par le canal que le client a utilisé à l'origine. Les réponses s'enchaînent automatiquement — le client voit une conversation continue dans son client mail, pas un message séparé à chaque fois.

## Actions en masse

Pour agir sur plusieurs fils à la fois, coche les cases dans la liste des conversations. La barre d'outils dévoile les actions en masse disponibles : changer de statut (fermer, rouvrir, archiver, marquer comme spam), ou envoyer une réponse en diffusion sur chaque fil sélectionné. Les actions en masse sont auditées au même niveau que les actions sur un seul fil ; chaque modification enregistre l'acteur et l'horodatage dans le [journal d'audit](/fr/platform/admin/governance).

## Filtrer et chercher

Le menu de filtres dans la barre d'outils resserre la liste par statut de lecture (tous, lus, non lus). Le raccourci `Ctrl + K` (ou `Cmd + K` sur macOS) ouvre la recherche sur tous les fils — le sujet, le corps et le courriel client sont indexés.

## Où ça s'inscrit

Conversations, c'est la boîte de réception client de Tale. Elle existe parce que le travail de réponse client ne tient pas dans le chat avec l'IA : les réponses demandent un humain dans la boucle, un fil unique par client à travers les canaux, et un historique que les relecteurs peuvent auditer. L'agent qui assure le côté IA est le même que celui que le reste de l'espace de travail utilise — ce qui change, c'est la surface.

Pour configurer quelles conversations reçoivent des brouillons de réponse auto, ouvre l'agent dans [Créer un agent](/fr/platform/agents/create) et câble l'outil de traitement de conversations. Pour les approbations qui sortent d'un fil client — un brouillon de réponse en attente de relecture, un appel d'intégration en attente de feu vert —, [Approbations](/fr/platform/workspace/approvals) est la surface.
