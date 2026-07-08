---
title: Automatisations livrées
description: Ce que fait chacune des quatre automatisations livrées, l’intégration qu’elle requiert, et comment le bundle Résoudre les issues GitHub transforme des issues synchronisées en pull requests fusionnées.
---

Tale livre des automatisations prêtes à l’emploi : trois à but unique qui transforment une boîte aux lettres en une boîte de réception partagée, et un bundle qui résout les issues GitHub de bout en bout. Les Éditeurs et Membres se servent de ce qu’une automatisation installée ajoute — un onglet Boîte de réception, une entrée de Backlog — sans rien installer eux-mêmes ; installer est une action Propriétaire/Admin/Développeur couverte sur [Parcourir et installer des automatisations](/fr/platform/automations/catalog). Cette page nomme ce que fait chacune et l’intégration qu’il faut connecter en premier.

## Répondre aux e-mails Gmail, Outlook et IMAP

**Répondre aux e-mails Gmail**, **Répondre aux e-mails Outlook** et **Répondre aux e-mails via SMTP/IMAP** sont la même automatisation répétée trois fois, une par type de boîte aux lettres : chacune requiert exactement l’intégration que son nom indique, et chacune installe la même vue intégrée **Boîte de réception**, indépendante du canal. Une organisation qui reçoit du courrier sur plus d’un type de boîte aux lettres en installe plusieurs ; chaque Boîte de réception ne montre que le trafic de sa propre boîte aux lettres.

| Automatisation                     | Requiert  | Boîte aux lettres                 |
| ---------------------------------- | --------- | --------------------------------- |
| Répondre aux e-mails Gmail         | Gmail     | Une boîte Gmail                   |
| Répondre aux e-mails Outlook       | Outlook   | Une boîte Microsoft Outlook       |
| Répondre aux e-mails via SMTP/IMAP | IMAP/SMTP | Toute boîte privée en IMAP / SMTP |

## L’onglet Boîte de réception

Chacune des trois s’ouvre sur son onglet **Boîte de réception** : quatre sous-onglets — **Ouvert**, **Fermé**, **Spam**, **Archivé** — chacun une vue scindée avec la liste des conversations à gauche et le fil sélectionné à droite. Ouvrir une conversation remplit le panneau de droite avec tout l’historique de ses messages ; tant que tu n’en as choisi aucune, le panneau affiche **Sélectionne une conversation pour voir les détails**.

Le compositeur se trouve sous le fil dans l’onglet **Ouvert** — les réponses appartiennent aux conversations actives, donc les trois autres onglets sont en lecture seule. Écris dans **Saisis un message** et clique sur **Envoyer** ; la réponse part par la boîte aux lettres sur laquelle la conversation est arrivée, avec le destinataire et l’objet dérivés du fil — rien à adresser à la main. **Améliorer** réécrit ton brouillon avec l’IA avant l’envoi. Sur l’automatisation IMAP, les réponses envoyées depuis la boîte elle-même — depuis n’importe quel client mail — se synchronisent aussi dans la conversation, ordonnées avec le reste du fil.

L’en-tête du fil porte les verbes de statut de la conversation sélectionnée — **Fermer la conversation** et **Marquer comme spam** sur un fil ouvert, **Rouvrir la conversation** sur un fil fermé ou archivé, **Pas du spam** et le destructeur **Supprimer** sur le spam. Sélectionner plusieurs lignes dans la liste fait apparaître les mêmes verbes en actions groupées.

## Résoudre les issues GitHub

**Résoudre les issues GitHub** est un bundle, pas une automatisation seule : l’installer lance un seul assistant agrégé qui installe quatre automatisations cachées d’un coup, liées au projet que tu choisis, et requiert l’intégration GitHub. Chaque membre couvre une étape de la boucle. **Trier les issues GitHub** — « Évalue les issues GitHub ouvertes d’un dépôt et propose les issues exploitables dans le backlog du projet — un humain les démarre depuis là. » — tourne sur une planification récurrente. **Synchroniser les issues GitHub** — « Termine une tâche du tableau lorsque son issue GitHub est fermée. Parcourt les tâches ouvertes du tableau lui-même, sans jamais en manquer. Mise à jour uniquement — ne crée jamais de tâche. » — que la fermeture vienne de la chaîne de résolution ou d’un humain agissant directement sur GitHub, le résultat est le même : jamais de création, jamais de réouverture. **Créer des pull requests GitHub** livre l’agent PR Creator : une fois qu’un humain a cliqué **Démarrer** sur une tâche proposée, il clone le dépôt, ouvre ou reprend la pull request de l’issue, implémente le correctif, le vérifie contre les tests du projet, et attend que la CI passe au vert. **Examiner les pull requests GitHub** livre l’agent PR Reviewer : il reteste la branche du PR Creator, confirme la CI, et un juge sans outils décide de la fusionnabilité — approuvé gare la tâche en **En revue** pour qu’un humain la fusionne sur GitHub ; non approuvé la renvoie au PR Creator avec un retour, jusqu’à un petit plafond de reprises.

Un humain reste dans la boucle à deux moments : démarrer une tâche proposée depuis le Backlog, et fusionner la pull request sur GitHub lui-même — rien dans le bundle ne fusionne à ta place.

## Où cela s’inscrit

Les trois automatisations de boîte de réception et le bundle Résoudre les issues GitHub sont ce qui est livré aujourd’hui ; une automatisation privée que ton organisation construit ou téléverse apparaît dans le même catalogue, juste à côté. [Parcourir et installer des automatisations](/fr/platform/automations/catalog) couvre la mécanique du catalogue ; [Backlog du projet](/fr/platform/projects/backlog) est la lecture suivante pour ce qui arrive à une tâche une fois que Trier les issues GitHub l’a proposée.
