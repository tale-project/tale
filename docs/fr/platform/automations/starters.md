---
title: Partir d’un modèle
description: Crée une automatisation prête à l’emploi à partir d’un modèle en répondant à quelques questions, démarre-la tout de suite et vois ce que fait chaque modèle.
---

Un modèle d’automatisation est une automatisation que Tale fournit prête à fonctionner. Tu réponds à quelques questions — le projet qu’elle sert, qui elle prévient, quand elle s’exécute — et Tale la crée comme ta propre automatisation, que tu modifies comme n’importe quelle autre. Seuls les rôles Propriétaire, Admin et Développeur créent des automatisations.

## En créer une

1. Ouvre **Automatisations** et choisis **Créer une automatisation** › **À partir d’un modèle**.
2. Choisis un modèle. Sa page indique ce qu’il fait, ce qui le démarre et quelles étapes il exécute.
3. Réponds à ses questions. **Nom** reprend d’abord le nom du modèle ; change-le pour distinguer tes automatisations.
4. Laisse **Démarrer maintenant** coché pour mettre la version 1 en service et activer son déclencheur tout de suite. Décoché, l’automatisation est créée comme brouillon que tu mets en service depuis l’[éditeur](/fr/platform/automations/editor).
5. Choisis **Créer l’automatisation**. La nouvelle automatisation s’ouvre dans l’éditeur.

<Frame caption="Chaque modèle dit en une ligne ce qu’il fait.">

![La boîte de dialogue Choose a starter avec un champ de recherche et cinq modèles : Answer questions from your documents, Create tasks from a webhook, Summarize the inbox, Tell the reviewer et Triage new tasks, chacun avec une ligne de description.](/images/platform/automation-starter-gallery.webp)

</Frame>

<Frame caption="Tell the reviewer, rempli pour le projet Website relaunch, avec Priya Raman à prévenir.">

![La boîte de dialogue Tell the reviewer : ce que fait le modèle, How it works avec ses deux étapes, Name, Project Website relaunch, Reviewer Priya Raman, Message, Start it now coché et le bouton Create automation.](/images/platform/automation-starter-setup.webp)

</Frame>

Depuis la liste **Automatisations** d’un projet, un modèle qui sert un projet commence avec ce projet choisi, et la nouvelle automatisation s’ouvre dans le projet.

Un modèle démarré par un webhook affiche son adresse une seule fois, juste après la création. Copie-la avant de choisir **Ouvrir l’automatisation** : seul un hachage de son token est conservé, une adresse perdue ne peut donc être remplacée qu’avec **Renouveler le token** — voir [Recevoir un webhook](/fr/platform/automations/triggers#recevoir-un-webhook).

Quand Tale ne peut pas utiliser une réponse — un projet que tu ne peux pas ouvrir, ou une personne qui n’est pas membre de l’organisation —, la question dit pourquoi, et rien n’est créé. Un nom déjà porté par une autre automatisation est refusé aussi ; choisis-en un autre.

## Les modèles

| Modèle | Démarre | Ce qu’il fait |
| --- | --- | --- |
| **Répondre aux questions avec tes documents** | Quand une tâche est créée dans le projet | Pour une tâche dont le titre se termine par un point d’interrogation, il cherche dans les documents de l’organisation et commente une réponse tirée uniquement de ce qu’il a trouvé, en citant ses sources. Les autres nouvelles tâches ne sont pas touchées. |
| **Créer des tâches par webhook** | À chaque envoi vers son adresse webhook | Crée une tâche dans le projet : le `title` du JSON de l’envoi lui donne son nom, et sa `description` son texte. Un envoi sans titre est refusé et ne crée rien. |
| **Résumer la boîte de réception** | Selon son horaire — les jours ouvrés à 08:00 dans ton fuseau horaire, tant que tu ne le changes pas | Résume en une ligne chacune, la plus urgente d’abord, les conversations de la boîte choisie qui attendent encore une réponse, et envoie le résumé au membre choisi. |
| **Prévenir le relecteur** | Quand une tâche du projet change de statut | Quand la tâche passe à **En revue**, il prévient le membre choisi, avec un lien vers la tâche. |
| **Trier les nouvelles tâches** | Quand une tâche est créée dans le projet | Commente la tâche avec une priorité suggérée et une première étape, dans la langue de la tâche. Rien d’autre ne change sur la tâche. |

Les messages de **Résumer la boîte de réception** et **Prévenir le relecteur** arrivent dans les notifications du membre, et par e-mail si ses réglages en envoient un ; [Notifier des membres depuis une automatisation](/fr/platform/automations/notify-members) explique qui est ignoré. Un modèle d’automatisation nomme un modèle de langage pour ses étapes qui en appellent un : quand aucun de tes fournisseurs ne le sert, chacune de ces étapes reçoit un modèle comparable qu’ils servent, et le message de la version 1 dit lequel.
