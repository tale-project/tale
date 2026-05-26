---
title: Tutoriels
description: Guides end-to-end orientés tâche, pour chaque rôle Tale.
---

La section Tutoriels est la couche d'exemples travaillés de la documentation Tale. Chaque page prend un résultat unique — un agent qui répond aux questions de support produit, un script qui appelle Tale depuis un job CI, un add-in Office qui passe par ton instance — et déroule chaque étape nécessaire pour y arriver sur une instance fraîche. Elles complètent la référence [Platform](/fr/platform) : la référence décrit ce que chaque fonctionnalité fait isolément, les tutoriels montrent comment les combiner pour atteindre un résultat concret.

Les tutoriels sont groupés par le rôle propriétaire de la tâche, pour que tu atterrisses sur du contenu que tu peux vraiment exécuter avec les permissions que tu as. Les permissions suivent le [modèle à six rôles](/fr/platform/admin/members-and-roles) — si un tutoriel vit sous Admin, il te faut un siège Admin ou Propriétaire pour le terminer.

## Comment un tutoriel est construit

Chaque tutoriel suit la même forme : une courte introduction qui nomme le résultat et les prérequis, une section **Avant de commencer** qui liste exactement ce qu'il faut, des étapes numérotées à action unique avec une ligne de vérification chacune, une section **Dépannage** couvrant les trois ou quatre problèmes qui surviennent vraiment, et une clôture qui nomme où le bloc se branche ensuite. Les tutoriels d'intégration (add-in Office, Meetily, fournisseur local) portent une section **Notes de confidentialité** ou **Limite de confiance** supplémentaire qui nomme ce qui traverse le réseau dans chaque direction.

Si une étape a l'air de faire deux choses à la fois, relis-la — chaque étape a une action et une vérification. Sauter une section en supposant que le prérequis est déjà rempli est la façon la plus fréquente dont un tutoriel échoue à mi-chemin ; l'étape suivante dépend en général du champ précis que la section sautée configure.

## Pages de cette section

- **[Chatter efficacement](/fr/tutorials/member/chat-effectively)** — tutoriel pour le rôle Membre, qui combine sélecteur d'agent, pièces jointes, dictée et Canevas dans un workflow de chat quotidien.
- **[Construire ton premier agent end-to-end](/fr/tutorials/editor/first-agent-end-to-end)** — tutoriel pour le rôle Éditeur, qui te mène d'une page d'agent vide à un agent versionné, à savoir limité, que ton équipe peut sélectionner dans le chat.
- **[Appeler Tale depuis un script](/fr/tutorials/developer/call-tale-from-a-script)** — tutoriel pour le rôle Développeur, qui envoie une requête de chat depuis cURL et Python via l'API OpenAI-compatible de Tale.
- **[Déclencher une automatisation via webhook](/fr/tutorials/developer/trigger-automation-via-webhook)** — tutoriel pour le rôle Développeur, qui branche un système externe à un workflow Tale via l'URL webhook unique.
- **[Add-in Word & Excel](/fr/tutorials/admin/office-add-in)** — tutoriel d'intégration pour le rôle Admin, qui route un panneau IA sideloadé dans Microsoft 365 à travers un agent Tale.
- **[Transcription de réunions](/fr/tutorials/admin/meeting-transcription)** — tutoriel d'intégration pour le rôle Admin, qui associe Tale à Meetily pour que l'audio brut reste sur le portable et que seule la transcription atteigne ton instance.
- **[Connecter un fournisseur local](/fr/tutorials/admin/connect-local-provider)** — tutoriel d'intégration pour le rôle Admin, qui ajoute Ollama ou vLLM comme fournisseur IA Tale pour que l'inférence du modèle reste dans ton réseau.

## Où ça s'inscrit

Les tutoriels couvrent les quatre points d'entrée canoniques dans Tale — Membre, Éditeur, Développeur, Admin — plus trois intégrations par-dessus. Pour le modèle conceptuel derrière chaque tutoriel, la page correspondante sous [Platform](/fr/platform) est la référence ; pour les surfaces API et SDK sur lesquelles les tutoriels développeurs reposent, [Develop](/fr/develop/api-reference) est un onglet plus loin.
