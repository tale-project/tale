---
title: Connaissances d’agent
description: L’onglet Connaissances de l’agent — un seul réglage décide quel corpus sa recherche a le droit de lire, et où passe la frontière avec les outils et les pièces jointes.
---

Les connaissances, c’est ce qu’un agent peut retrouver et citer au moment de répondre. Sans elles il reste générique ; avec elles il répond à partir du matériel de ton organisation et montre d’où vient sa réponse. L’onglet **Connaissances** de l’agent porte une seule décision : quel corpus la recherche de cet agent a le droit de lire.

Cette décision est plus petite qu’elle ne devait l’être auparavant, parce que la recherche elle-même n’est plus un mode que tu configures. Un agent cherche quand il juge en avoir besoin, et rien n’est injecté dans une réponse sans qu’il soit allé le chercher.

## Choisir une portée

Quatre valeurs, un seul réglage :

- **Documents** — les fichiers téléversés par l’organisation, et rien d’autre.
- **Web** — les pages récupérées pour le compte de l’organisation, et rien d’autre.
- **Tout** — les deux corpus, fusionnés en un seul classement. C’est ce qu’obtient un agent que personne n’a restreint.
- **Rien** — aucune recherche n’est proposée à l’agent. Choisis-le quand son travail est de raisonner ou de rédiger et que des citations ne feraient que du bruit.

Chaque corpus appartient à ton organisation : élargir la portée ne franchit donc jamais la frontière vers le matériel d’un autre client. Cela décide seulement de la part du tien vers laquelle l’agent est pointé.

## Restreindre à dessein

Tout ce qui est dans la portée se dispute la pertinence à chaque question, et c’est pourquoi une portée étroite répond en général mieux qu’une portée large. Un agent pointé sur les documents que ton équipe entretient vraiment trouve le bon passage ; le même agent pointé en plus sur toutes les pages collectées doit d’abord battre le bruit.

Choisis **Documents** quand la vérité vit dans des fichiers que tu contrôles et qu’une page web périmée serait un risque. Choisis **Web** quand le travail de l’agent porte sur ce qui est publié plutôt que sur ce qui est classé. Choisis **Tout** quand les deux comptent réellement et que tu préfères le rappel. Le matériel lui-même — ce qui est téléversé, collecté et indexé — se gère sous [Documents](/fr/platform/knowledge/documents) et [Sites web](/fr/platform/knowledge/crawling), pas ici : cet onglet ne fait qu’y pointer l’agent.

## Comment la recherche arrive dans la réponse

Quand l’agent cherche, les citations se rattachent aux phrases qu’elles étayent — le survol montre la source, le clic l’ouvre. Un document dont l’indexation n’est pas terminée n’est pas encore trouvable : un agent qui semble ignorer une source évidente attend donc souvent l’index plutôt qu’il n’est mal réglé.

## Quand y recourir

Les enregistrements structurés et les systèmes vivants sont des outils, pas des connaissances, et un fichier qui ne compte que pour une conversation est une pièce jointe. Les frontières :

| Prends…                                                      | Quand l’agent a besoin…                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| Les connaissances (cet onglet)                               | De chercher et citer le matériel de l’organisation                 |
| [Les outils](/fr/platform/agents/tools)                      | De contacts, produits, fournisseurs, sites web ou systèmes vivants |
| [Les pièces jointes](/fr/platform/chat/attachments)          | D’un fichier qui ne compte que pour une conversation               |
| [Les agents de projet](/fr/platform/projects/project-agents) | De connaissances limitées à un projet                              |

## Où cela se place

Les connaissances d’agent répondent à une seule question : cet agent doit-il lire les documents de l’organisation, son web collecté, les deux, ou aucun. La section [Connaissances](/fr/platform/knowledge/overview) plus large est là où ces sources vivent et s’indexent ; cet onglet raccorde un agent à une tranche d’entre elles. Pour le parcours complet — téléverser, cadrer, demander, vérifier les citations — suis [Agent avec connaissances](/fr/tutorials/editor/agent-with-knowledge).
