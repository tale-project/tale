---
title: Entrées de connaissances
description: Les entrées de connaissances sont de petits faits indexés par sujet que les utilisateurs apportent à la base de connaissances — capturés depuis le chat avec approbation ou ajoutés manuellement. Cette page couvre d'où viennent les entrées, la règle d'une version live par sujet, et comment les gérer.
---

Les entrées de connaissances sont la surface des faits de la base de connaissances. Là où un document porte un fichier entier, une entrée de connaissances porte un petit fait durable — « le magasin ouvre à 9 h », « le délai de retour est de 3 jours » — sous un nom de sujet. Les entrées viennent de deux sources : un agent peut en proposer une pendant un chat quand tu confirmes ou corriges une information (tu l'approuves sur une carte avant que quoi que ce soit soit enregistré), et les Éditeurs peuvent en ajouter une manuellement depuis l'onglet **Entrées de connaissances**. Dans les deux cas, l'entrée passe par la même pipeline d'indexation qu'un document, donc chaque agent qui cherche dans la base de connaissances peut la récupérer et la citer.

Cette page couvre le côté gestion : d'où viennent les entrées, la règle d'une version live par sujet qui empêche les corrections de coexister avec les faits qu'elles ont corrigés, et comment ajouter, modifier et supprimer des entrées.

## D'où viennent les entrées

**Depuis le chat, avec ton approbation.** Les agents avec le tool `knowledge_write` activé peuvent proposer d'enregistrer un fait que tu as énoncé ou corrigé pendant une conversation. La proposition apparaît comme une carte d'approbation dans le chat avec le sujet, le contenu complet et — quand le sujet existe déjà — un avis indiquant que l'approbation remplacera l'entrée actuelle. Rien n'atteint la base de connaissances avant que tu cliques sur **Approuver** ; **Rejeter** écarte la proposition. Le tool est désactivé par défaut — active-le par agent dans les réglages de tools de l'agent sous le groupe Documents. C'est voulu : un agent ne peut jamais écrire dans la connaissance partagée de l'org sans qu'un humain valide le texte exact.

**Manuellement.** Pour ajouter une entrée à la main, ouvre **Connaissance > Entrées de connaissances** et clique sur **Ajouter une entrée**. Donne-lui un sujet (jusqu'à 120 caractères — court et stable, comme un titre) et le contenu en markdown (jusqu'à 8000 caractères), rédigé pour être compréhensible sans la conversation autour. Les entrées manuelles sautent la carte d'approbation — tu es l'humain dans la boucle.

## Une version live par sujet

Les sujets sont la clé de déduplication. Écrire sur un sujet qui a déjà une entrée — depuis le chat ou en modifiant — remplace la version live au lieu d'en ajouter une seconde ; la base de connaissances ne sert donc jamais deux versions du même fait. La correspondance de sujets ignore la casse et les espaces superflus : « Horaires d'ouverture » et « horaires d'ouverture » sont le même sujet.

Les versions remplacées ne sont pas perdues. Chaque entrée garde son historique des versions — clique sur une ligne pour ouvrir l'entrée et déplie une version remplacée pour voir ce qu'elle disait et quand elle a été remplacée. Seule la version live est indexée pour la récupération ; les versions remplacées n'existent que pour l'audit et la consultation.

## Comment les entrées atteignent les agents

Derrière chaque entrée se trouve un petit document markdown dans le hub de documents, dans le dossier réservé **Knowledge entries**. Ce document de fond passe par exactement la même pipeline d'indexation qu'un fichier téléversé — extraire, découper, embed, ranger — c'est pourquoi la liste des entrées montre le badge de statut d'indexation familier par ligne. Une entrée fraîchement enregistrée montre brièvement `Indexation` ; dès qu'elle bascule sur `Indexé`, les agents dont le périmètre de connaissances inclut le document de fond la récupèrent et la citent comme n'importe quelle autre source.

Parce que le document de fond est un document ordinaire, la liaison aux agents fonctionne sans changement : un agent cadré sur toute la bibliothèque voit chaque entrée, et un agent cadré sur des dossiers spécifiques voit les entrées seulement si le dossier Knowledge entries est dans le périmètre. Les entrées valent pour toute l'org — il n'y a pas de cadrage par équipe sur les entrées elles-mêmes dans cette version.

## Modifier et supprimer

Pour modifier une entrée, ouvre son menu de ligne et clique sur **Modifier**. Enregistrer crée une nouvelle version live et déplace la précédente dans l'historique des versions ; le document de fond est réindexé en arrière-plan, donc les résultats de recherche prennent le nouveau texte dès que le badge de statut revient à `Indexé`. Renommer le sujet emporte l'historique des versions avec lui.

Pour supprimer une entrée, ouvre son menu de ligne et clique sur **Supprimer**. La suppression retire l'entrée entière — version live, historique, le document de fond et les chunks indexés — donc les agents ne peuvent plus trouver le fait. Il n'y a pas d'annulation ; si le fait était juste, ajoute-le à nouveau. Supprimer le document de fond depuis l'onglet Documents a le même effet : l'entrée est retirée aussi, pour que les deux vues ne divergent jamais.

## Où cela s'inscrit

Les entrées de connaissances bouclent la boucle entre les conversations et la base de connaissances : une correction faite une fois dans le chat devient un fait que chaque agent récupère, avec un humain qui approuve la formulation exacte et une version live par sujet qui garantit que l'ancien fait disparaît quand le nouveau arrive. Pour la moitié fichiers de la base de connaissances, lis [Documents](/fr/platform/knowledge/documents) ; pour comment un agent se lie à la connaissance et récupère dessus à la réponse, lis [Connaissance d'agent](/fr/platform/agents/knowledge).
