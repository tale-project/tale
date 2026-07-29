---
title: Piper les transcriptions de réunions dans la Base de connaissances
description: Câble Meetily (ou un outil local de transcription de réunions similaire) dans la Base de connaissances d'un projet Tale pour que les transcriptions atterrissent toutes seules comme documents, sans que personne ne charge un fichier.
---

Une transcription de réunion est l'un des documents les plus précieux qu'un projet puisse garder — noms, décisions, suivis, le tout dans un endroit cherchable. Ce parcours intègre Meetily, un outil local de transcription de réunions, avec un projet Tale pour que chaque transcription que produit Meetily atterrisse dans la Base de connaissances du projet comme document à part entière. Le parcours s'adresse à un Admin sur une instance Tale auto-hébergée qui l'associe à un install Meetily sur le même réseau.

Il te faut un rôle Admin dans Tale, un install Meetily joignable depuis le conteneur `tale-platform` et un projet dans Tale avec une Base de connaissances vers laquelle router les transcriptions. Le concept de Base de connaissances vit dans [Base de connaissances](/fr/platform/knowledge/overview) ; cette page est le parcours de connector, pas la page de concept.

## Avant de commencer

Confirme quatre choses. Ton rôle est Admin ou Propriétaire dans Tale — le panneau **Connectors** est caché en dessous. Meetily tourne et produit des transcriptions dans un format que Tale accepte (Markdown, texte brut ou VTT). L'hôte Meetily est joignable depuis `tale-platform` par son chemin webhook ou son dossier partagé. Et le projet cible existe déjà dans Tale avec une Base de connaissances attachée — le connector écrit _dans_ une Base de connaissances, elle n'en crée pas.

## Étape 1 — Choisir un chemin de livraison

Meetily peut remettre des transcriptions à Tale sous deux formes, et elles ont des propriétés opérationnelles différentes. Le choix verrouille la suite du parcours.

Le chemin **webhook** fait que Meetily POSTe chaque transcription terminée à un endpoint d'ingestion Tale dès que la réunion finit ; la transcription est dans la Base de connaissances en quelques secondes après la fin de la réunion. Le chemin **dossier partagé** fait que Meetily écrit les transcriptions comme fichiers dans un répertoire que la plateforme Tale poll chaque minute ; la latence va jusqu'à une minute mais le chemin n'a besoin d'aucune URL publique et survit aux redémarrages de Meetily sans logique de retry.

Choisis le webhook quand les deux services tournent dans le même réseau et que tu veux une indexation rapide ; choisis le dossier partagé quand Meetily tourne sur un poste qui s'éveille de manière irrégulière ou quand l'équipe d'exploitation préfère une trace d'audit basée fichier.

## Étape 2 — Créer l'endpoint d'ingestion ou le dossier dans Tale

Tale doit savoir où les transcriptions atterriront et à quel projet elles appartiennent. Sans cette liaison, les transcriptions arrivent mais aucune Base de connaissances ne les réclame.

Ouvre **Paramètres > Connectors**, clique **Ajouter une connector** et choisis **Transcriptions de réunions**. Choisis le projet dans la liste déroulante — la Base de connaissances que le projet utilise est la destination. Choisis le chemin de livraison que tu as choisi à l'étape 1.

Si tu as choisi le webhook, Tale génère une URL de la forme `https://<ton-hôte>/connectors/transcripts/<token>` et la montre une fois. Copie l'URL ; elle sert aussi de credential bearer, donc traite-la comme un secret.

Si tu as choisi le dossier partagé, Tale demande le chemin sur disque que `tale-platform` doit surveiller (typiquement `/data/transcripts/<project-slug>`). Crée le répertoire sur l'hôte, donne-lui une appartenance de groupe qui correspond à l'utilisateur du conteneur `tale-platform`, et confirme.

## Étape 3 — Pointer Meetily vers Tale

Meetily doit maintenant savoir où livrer chaque transcription. Les réglages vivent dans la config propre à Meetily.

Pour le chemin webhook, ouvre les paramètres de Meetily et ajoute une destination webhook avec l'URL de l'étape 2. Choisis le format de transcription — le Markdown est ce qui se lit le mieux dans un aperçu de document Tale, mais le VTT et le texte brut s'indexent correctement tous les deux.

Pour le chemin dossier partagé, règle le répertoire de sortie de transcriptions de Meetily sur le chemin que tu as créé à l'étape 2. Assure-toi que Meetily écrit un fichier par réunion, nommé avec le titre de la réunion et l'horodatage.

Termine une courte réunion de test dans Meetily et observe le panneau Connectors de Tale. La ligne de connector affiche un horodatage **Dernière livraison** qui se met à jour dans la minute (mode dossier) ou en quelques secondes (mode webhook).

## Étape 4 — Vérifier que le document atterrit et s'indexe

La preuve que le câblage marche est une transcription visible dans la Base de connaissances comme document cherchable. Sans cette étape tu ne sais pas si Tale a reçu le fichier _et_ l'a indexé.

Ouvre le projet cible, navigue vers sa Base de connaissances et cherche la nouvelle transcription en haut de la liste des documents. Clique dans l'aperçu — la transcription se rend comme document avec le titre de la réunion en nom de document et la date de la réunion en created-at. Attends que le badge d'indexation se libère (quelques secondes pour une courte transcription, jusqu'à une minute pour une longue), puis lance une recherche sur un nom ou une phrase dont tu te souviens de la réunion de test. La transcription devrait être le premier résultat avec la phrase surlignée.

Si le document est là mais que le badge d'indexation reste orange, l'indexation est en retard — la page [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) nomme les symptômes.

## Notes de confidentialité

L'connector traverse un réseau dans chaque direction et la forme des données compte.

- **Meetily → Tale.** Le corps de la transcription traverse, plus le titre de la réunion, l'horodatage et les étiquettes de locuteur que Meetily a attachées. L'audio ne traverse pas — Meetily transcrit localement et seul le texte est livré. Le chemin webhook utilise HTTPS avec le token bearer dans l'URL ; le chemin dossier utilise un chemin de système de fichiers sans réseau du tout.
- **Tale → Meetily.** Rien. L'connector est à sens unique ; Tale ne rappelle jamais Meetily.
- **Tale → services externes.** Le texte de la transcription traverse vers le fournisseur d'embedding qui est lié à la Base de connaissances. Si le fournisseur d'embedding est local (Ollama, LM Studio, vLLM via [Brancher un fournisseur LLM local](/fr/tutorials/admin/connect-local-provider)), aucun texte de transcription ne quitte l'hôte. Si le fournisseur d'embedding est OpenAI, Anthropic ou un autre endpoint hébergé, le texte de la transcription est envoyé à cet endpoint pour vectorisation selon la politique de traitement des données de ce fournisseur.

Quand les transcriptions contiennent du contenu que l'organisation ne peut pas envoyer à un fournisseur cloud, le pattern pris en charge est de lier la Base de connaissances du projet à un modèle d'embedding local. La liaison du fournisseur se passe dans les paramètres de la Base de connaissances, pas dans cette connector.

## Où cela s'inscrit

L'connector de transcription de réunions est l'exemple le plus net de « Tale indexe ce que tes autres outils produisent déjà » — pas de copier-coller, pas d'upload manuel, pas d'étape supplémentaire dans le flux de réunion. Les prochaines lectures naturelles sont [Base de connaissances](/fr/platform/knowledge/overview) pour à quoi la transcription indexée peut alors servir à l'intérieur d'un agent, et [Brancher un fournisseur LLM local](/fr/tutorials/admin/connect-local-provider) quand la section ci-dessus te pousse à garder l'étape d'embedding sur l'hôte.
