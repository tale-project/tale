---
title: Automatisations livrées
description: Ce que fait chaque automatisation livrée — le trio boîte de réception, le bundle Résoudre les issues GitHub, les modèles de synchronisation et d’entretien, et les packs préinstallés qui font tourner tableaux et mentions.
---

Tale livre des automatisations prêtes à l’emploi : trois à but unique qui transforment une boîte aux lettres en une boîte de réception partagée, et un bundle qui résout les issues GitHub de bout en bout. Les Éditeurs et Membres se servent de ce qu’une automatisation installée ajoute — un onglet Boîte de réception, une entrée de Backlog — sans rien installer eux-mêmes ; installer est une action Propriétaire/Admin/Développeur couverte sur [Parcourir et installer des automatisations](/fr/platform/automations/catalog). Cette page nomme ce que fait chacune et l’connector qu’il faut connecter en premier.

<Frame caption="Le catalogue des automatisations — chaque carte est à une installation près ; les membres de packs cachés et l’intérieur des bundles restent hors de la liste.">

![Le catalogue des automatisations sur l’onglet Toutes les automatisations, avec les cartes des automatisations e-mail et du bundle Résoudre les issues GitHub, chacune avec son icône et sa description.](/images/platform/automations-catalog.webp)

</Frame>

## Synchroniser les e-mails Gmail, Outlook et IMAP

**Synchroniser les e-mails Gmail**, **Synchroniser les e-mails Outlook** et **Synchroniser les e-mails via SMTP/IMAP** sont la même automatisation répétée trois fois, une par type de boîte aux lettres : chacune requiert exactement le connecteur que son nom indique, chacune installe la même vue intégrée **Boîte de réception**, indépendante du canal, et chacune embarque le workflow de synchronisation qui rapatrie la boîte aux lettres dans les conversations selon une planification, toutes les cinq minutes d'origine — change le [déclencheur de planification](/fr/platform/automations/triggers) pour rapatrier moins souvent. Une organisation qui reçoit du courrier sur plus d'un type de boîte aux lettres en installe plusieurs ; chaque Boîte de réception ne montre que le trafic de sa propre boîte aux lettres.

| Automatisation                         | Requiert  | Boîte aux lettres                 |
| -------------------------------------- | --------- | --------------------------------- |
| Synchroniser les e-mails Gmail         | Gmail     | Une boîte Gmail                   |
| Synchroniser les e-mails Outlook       | Outlook   | Une boîte Microsoft Outlook       |
| Synchroniser les e-mails via SMTP/IMAP | IMAP/SMTP | Toute boîte privée en IMAP / SMTP |

## L’onglet Boîte de réception

Chacune des trois s’ouvre sur son onglet **Boîte de réception** : quatre sous-onglets — **Ouvert**, **Fermé**, **Spam**, **Archivé** — chacun une vue scindée avec la liste des conversations à gauche et le fil sélectionné à droite. Ouvrir une conversation remplit le panneau de droite avec tout l’historique de ses messages ; tant que tu n’en as choisi aucune, le panneau affiche **Sélectionne une conversation pour voir les détails**.

Le champ de message se trouve sous le fil dans l’onglet **Ouvert** — les réponses appartiennent aux conversations actives, donc les trois autres onglets sont en lecture seule. Écris dans **Saisis un message** et clique sur **Envoyer** ; la réponse part par la boîte aux lettres sur laquelle la conversation est arrivée, avec le destinataire et l’objet dérivés du fil — rien à adresser à la main. L’en-tête du fil montre le vrai **Expéditeur** de cette conversation — l’adresse à laquelle le contact a écrit, ou l’expéditeur que tu choisis à la rédaction — pour que ce que tu vois corresponde à ce qu’une réponse envoie vraiment. Sur une connexion Gmail ou Outlook, le champ **Expéditeur** à la rédaction est l’adresse du compte connecté ; sur IMAP/SMTP tu n’édites que la partie locale de **Expéditeur**, et le domaine vérifié reste fixé en badge pour que tu ne le quittes jamais. **Améliorer** réécrit ton brouillon avec l’IA avant l’envoi. Sur l’automatisation IMAP, les réponses envoyées depuis la boîte elle-même — depuis n’importe quel client mail — se synchronisent aussi dans la conversation, ordonnées avec le reste du fil.

L’en-tête du fil porte les verbes de statut de la conversation sélectionnée — **Fermer la conversation** et **Marquer comme spam** sur un fil ouvert, **Rouvrir la conversation** sur un fil fermé ou archivé, **Pas du spam** et le destructeur **Supprimer** sur le spam. Sélectionner plusieurs lignes dans la liste fait apparaître les mêmes verbes en actions groupées.

Les Admins et Propriétaires utilisent aussi le contrôle **Responsable** dans l’en-tête pour mettre le travail en file. Ouvre-le et choisis sous **Personnes** et **Équipe** — les deux dimensions sont indépendantes, donc une conversation peut rester dans la file d’une équipe et être quand même assignée à une personne. Changer la personne la notifie dans l’app et par e-mail ; assigner à une équipe notifie les membres de cette équipe (l’acteur est exclu dans les deux cas). S’assigner soi-même, retirer la personne (**Retirer l'attribution**) et retirer l’équipe (**Retirer l'équipe**) ne notifient personne. Les non-admins voient l’assignation courante en lecture seule. Associe l’assignation au [Routage des conversations](/fr/platform/admin/governance/policies-and-limits#routage-des-conversations) quand les adresses entrantes doivent atterrir automatiquement dans une file, et au [Contrôle selon l’assignation des conversations](/fr/platform/admin/governance/policies-and-limits#controle-selon-lassignation-des-conversations) quand un fil assigné doit rester privé à cette équipe ou cette personne.

## Résoudre les issues GitHub

**Résoudre les issues GitHub** est un bundle, pas une automatisation seule : l’installer lance un seul assistant agrégé qui installe quatre automatisations cachées d’un coup, liées au projet que tu choisis, et requiert l’connector GitHub. Chaque membre couvre une étape de la boucle. **Trier les issues GitHub** — « Évalue les issues GitHub ouvertes d’un dépôt et propose les issues exploitables dans le backlog du projet — un humain les démarre depuis là. » — tourne sur une planification récurrente. **Synchroniser les issues GitHub** — « Termine une tâche du tableau lorsque son issue GitHub est fermée. Parcourt les tâches ouvertes du tableau lui-même, sans jamais en manquer. Mise à jour uniquement — ne crée jamais de tâche. » — que la fermeture vienne de la chaîne de résolution ou d’un humain agissant directement sur GitHub, le résultat est le même : jamais de création, jamais de réouverture. **Créer des pull requests GitHub** livre l’agent PR Creator : une fois qu’un humain a cliqué **Démarrer** sur une tâche proposée, il clone le dépôt, ouvre ou reprend la pull request de l’issue, implémente le correctif, le vérifie contre les tests du projet, et attend que la CI passe au vert. **Examiner les pull requests GitHub** livre l’agent PR Reviewer : il reteste la branche du PR Creator, confirme la CI, et un juge sans outils décide de la fusionnabilité — approuvé gare la tâche en **En revue** pour qu’un humain la fusionne sur GitHub ; non approuvé la renvoie au PR Creator avec un retour, jusqu’à un petit plafond de reprises.

Un humain reste dans la boucle à deux moments : démarrer une tâche proposée depuis le Backlog, et fusionner la pull request sur GitHub lui-même — rien dans le bundle ne fusionne à ta place.

## Modèles de synchronisation et d’entretien

Huit automatisations de plus attendent dans le catalogue pour le moment où tu en as besoin. Chacune est un workflow unique : installe-la, pointe-la vers tes données — les modèles de synchronisation demandent leur source via la planification qu’ils créent — puis ajuste-la librement sur la page de l’automatisation, où une modification devient une nouvelle version que tu mets en service quand tu es prêt.

| Automatisation                             | Requiert     | Ce qu’elle fait                                                                                    |
| ------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------- |
| Synchroniser les pages Confluence          | Confluence   | Importe les pages d’un espace Confluence dans la bibliothèque de connaissances selon un planning   |
| Synchroniser les fichiers Google Drive     | Google Drive | Importe les documents d’un dossier Drive dans la bibliothèque de connaissances                     |
| Synchroniser les clients Shopify           | Shopify      | Importe les clients de la boutique dans les fiches contacts de l’organisation                      |
| Synchroniser les produits Shopify          | Shopify      | Importe le catalogue produits de la boutique dans les fiches produits de l’organisation            |
| Analyser les relations entre produits      | —            | Parcourt le catalogue et consigne accessoires, variantes et compléments                            |
| Indexer les documents pour la recherche    | —            | Indexe les documents fraîchement importés pour que les agents puissent les rechercher et les citer |
| Archiver les conversations inactives       | —            | Clôt les conversations restées silencieuses au-delà de leur période d’inactivité                   |
| Notifier les membres des messages entrants | —            | Alerte les membres dès qu’un nouveau message entrant arrive dans une conversation ouverte          |

## Les packs préinstallés

La mécanique qui fait tourner les tableaux de chaque organisation est elle aussi faite d’automatisations — installées automatiquement à la création, cachées du catalogue, mais visibles sur l’onglet **Installées** comme tout le reste. Le **pack tâches** lance un agent assigné dès qu’une tâche lui arrive, trie le travail non assigné, réagit aux @-mentions, fait passer le travail terminé par la relecture, balaie les exécutions bloquées, fait respecter les SLA et garde en mouvement tâches dépendantes, sous-tâches et archives ; un pack voisin garde les fichiers OneDrive synchronisés. Chacune est une automatisation normale — ouvre-la pour lire son document sur le canvas, suivre ce qu’elle a fait dans sa [liste des exécutions](/fr/platform/automations/execution-logs), ou couper un [déclencheur](/fr/platform/automations/triggers) pour qu’elle cesse de se lancer ; une désinstallation tient, et rien ne la réinstalle dans ton dos.

## Où cela s’inscrit

Les automatisations de boîte de réception, le bundle Résoudre les issues GitHub et les modèles de synchronisation sont ce qui est livré aujourd’hui ; une automatisation privée que ton organisation construit ou téléverse apparaît dans le même catalogue, juste à côté. [Parcourir et installer des automatisations](/fr/platform/automations/catalog) couvre la mécanique du catalogue ; [Backlog du projet](/fr/platform/projects/backlog) est la lecture suivante pour ce qui arrive à une tâche une fois que Trier les issues GitHub l’a proposée.
