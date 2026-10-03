---
title: "Quels accès faut-il donner à un agent IA ?"
description: "Pars d’une tâche de recherche pour définir ce qu’un agent IA peut lire et modifier, les identifiants nécessaires et les actions à faire approuver."
slug: ai-agent-security-permissions-approvals
topicId: T07
reviewed: '2026-10-03'
draft: false
coverAlt: "Des cadres imbriqués donnent à une tâche des ouvertures distinctes et une trace visible sur papier."
---

Donne à un agent IA les accès dont il a besoin pour sa tâche actuelle. S’il prépare une annonce de lancement, il lui faut peut-être lire les notes du projet et créer un brouillon. Il n’a pas besoin d’envoyer des e-mails, de publier l’annonce ou de modifier les accès au projet.

Commence par distinguer **lire des informations, produire un document et exécuter une action**. Un compte regroupe souvent ces trois possibilités, alors que la tâche n’en demande qu’une partie. Une bonne configuration de départ permet à l’agent de terminer un travail utile tout en laissant les actions superflues hors de sa portée.

## Déduis les accès nécessaires de la tâche

Prenons un agent qui vérifie des informations produit et rédige une annonce de lancement à partir d’un brief interne et des pages de fournisseurs. Une personne relira le brouillon avant tout envoi. Voici les accès nécessaires :

| Besoin | Accès à accorder | Accès à laisser indisponibles |
| --- | --- | --- |
| Comprendre le lancement | Lire le brief et les références sélectionnées du projet | Autres projets, dossiers du personnel et fichiers clients sans rapport |
| Vérifier les informations des fournisseurs | Consulter les sources publiques nécessaires | Sessions de navigateur connectées et envois de formulaires inutiles |
| Préparer l’annonce | Créer le rapport et le brouillon dans l’espace de sortie du projet | Modifier le brief d’origine ou publier sur le site en ligne |
| Transmettre le résultat | Fournir les fichiers et leurs sources pour relecture | Identifiants de messagerie, de publication sur les réseaux sociaux ou d’administration générale |

C’est une proposition pour cet exemple ; il reste à vérifier que tes outils peuvent faire respecter ces limites. Si un service ne propose qu’un compte aux droits étendus, écrire « lecture seule » dans le prompt ne restreint pas ce compte. Utilise une intégration plus limitée, fournis un export approuvé ou confie cette partie du travail à une personne.

Le même raisonnement s’applique aux données. L’accès à un projet ne justifie pas automatiquement l’accès à tous les documents que la personne qui lance l’agent peut ouvrir. Fournis les sources nécessaires, puis ajoutes-en quand une tâche concrète le demande.

![Les droits d’un agent dépendent de son identité, des données accessibles, de ses outils et identifiants, des approbations et des éléments conservés après une action.](/blog/diagrams/fr/T07-diagram.svg)

## Fais respecter la limite en dehors du prompt

L’instruction « n’envoie jamais le brief interne » indique ce que tu attends. Ne pas donner à l’agent d’identifiant permettant l’envoi limite ce qu’il peut faire. Les deux sont utiles : des consignes claires l’aident à travailler, tandis que les permissions des outils limitent les conséquences d’une erreur ou d’une source trompeuse.

Une page de fournisseur pourrait, par exemple, demander à l’agent d’envoyer le brief interne par e-mail pour « vérifier la compatibilité ». Cette page n’a pas autorité pour modifier la tâche. L’agent de recherche devrait ignorer la demande ; son équipement devrait aussi empêcher l’envoi s’il la suivait malgré tout. Les [recommandations OWASP sur les pouvoirs excessifs des agents](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) préconisent de limiter les fonctions, les permissions et les actions autonomes disponibles.

Examine tous les chemins permettant d’atteindre le même service. Un connecteur en lecture seule protège peu si l’agent dispose aussi d’un jeton de messagerie dans son shell. Autoriser le nom d’hôte d’un service d’e-mail est également plus large qu’autoriser un destinataire ou une pièce jointe précise.

Dans Tale, le relais de connecteurs propose uniquement des actions de lecture aux agents. Les outils d’écriture de la plateforme, les outils GitHub directs et les secrets explicitement accordés ont leurs propres règles d’accès. Vérifie l’équipement réel de l’agent avec le [guide des agents de projet](https://docs.tale.dev/fr/platform/projects/project-agents). Les restrictions d’un connecteur ne décrivent pas tous ses pouvoirs.

## Décide séparément de l’envoi

Si la tâche doit ensuite inclure l’envoi de l’annonce, ajoute cette étape délibérément. Conserve les accès de l’agent de recherche et utilise un chemin d’envoi séparé et limité. La personne qui décide devrait voir le destinataire exact, l’objet, le message et les pièces jointes.

Dans Tale, les écritures de connecteurs dans les automatisations réelles peuvent nécessiter une approbation selon la politique de l’organisation. Cela ne soumet pas chaque commande shell à une carte d’approbation. Vérifie les [règles d’approbation](https://docs.tale.dev/fr/platform/approvals/configure) applicables.

Une carte Tale permet d’approuver ou de rejeter les données proposées, pas de les modifier. Toute personne pouvant ouvrir la tâche peut décider sur une carte qui y apparaît ; la carte ne désigne pas un groupe d’approbateurs. Vérifie que ce cercle de personnes convient à ton besoin. [Détails des approbations d’opérations](https://docs.tale.dev/fr/platform/approvals/concepts)

Accepter un brouillon et autoriser son envoi sont deux décisions distinctes. Une annonce correcte peut encore être adressée au mauvais destinataire. Le guide sur [la place des approbations humaines dans un workflow IA](/fr/blog/human-in-the-loop-ai-agent-workflows) t’aide à choisir le point de contrôle et les informations à présenter.

## Teste ce que l’agent doit être incapable de faire

Exécute une tâche sans conséquence avec le rôle, les outils et les types d’identifiants que l’équipe utilisera réellement. Un essai réussi avec un compte administrateur ne montre pas ce qu’un autre utilisateur peut faire.

En plus de la tâche normale, essaie de lire un document de test non autorisé et d’envoyer un message sans approbation vers une boîte de test que tu contrôles. Vérifie le refus d’accès, le journal des actions du service d’envoi et la boîte de test ; aucune demande d’envoi ne doit avoir été acceptée. Utilise du contenu fictif et des comptes que tu contrôles. Tu cherches à obtenir un brouillon utile tout en gardant les actions exclues indisponibles.

Si tu ajoutes une étape d’approbation, essaie-la lors d’une exécution réelle et contrôlée. Le test avec réponses simulées de Tale n’effectue pas d’écritures externes et n’affiche pas de cartes d’approbation réelles. Rejette une opération proposée et vérifie qu’elle n’a pas eu lieu, puis teste l’approbation dans une autre exécution corrigée. Le [guide des approbations d’opérations](https://docs.tale.dev/fr/platform/approvals/concepts) explique cette distinction.

Conserve la liste d’accès avec la configuration de l’agent. La [fiche des autorisations d’action](/blog/worksheets/fr/T07-action-authority.md) permet de noter les outils, les références d’identifiants et les tests de refus. Revois-la quand la tâche reçoit une nouvelle destination ou une nouvelle action, notamment lorsqu’un agent jusque-là chargé de rédiger commence à publier ou à envoyer.
