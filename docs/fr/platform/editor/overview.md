---
title: Éditeur
description: Le siège curation de contenu — la base de connaissances, conversations, approbations, données structurées et les agents que le reste de l'équipe utilise. L'atterrissage orienté tâches de l'Éditeur pour le quotidien.
---

Un **Éditeur** dans Tale est le siège curation de contenu. Tu es la personne qui décide ce que l'IA sait et quelles actions en attente passent — les documents, les produits, les clients, les sites web dont lit le reste de l'organisation, plus les conversations clients et les approbations qui demandent un humain dans la boucle. Tout ce qu'un Membre peut faire, tu peux le faire ; en plus, tu écris dans la base de connaissances, modifies des agents et agis sur des approbations. Tu ne publies pas d'automatisations, ne configures pas d'intégrations et ne changes pas les paramètres d'organisation — c'est le territoire des Développeurs et des Admins.

L'intérêt d'avoir un siège Éditeur dédié, c'est que la curation des connaissances est un métier à part. Un agent construit par un Développeur ne vaut que ce que valent les documents contre lesquels il peut grounder ; une automatisation qui produit un brouillon de réponse n'est utile que dans la mesure où l'Éditeur le passe en revue et l'envoie. Cette page est un index orienté tâches pour la journée de l'Éditeur ; la matrice canonique de permissions vit sous [Membres et rôles](/fr/platform/admin/members-and-roles).

## Une journée d'Éditeur

Une journée typique commence dans **Conversations** pour vider les threads clients de la nuit — ceux pour lesquels l'IA a rédigé une réponse et ceux que l'IA a marqués pour relecture. De là, le travail se déplace vers **Approbations** : sorties d'automatisations qui attendent un verdict humain. En milieu de matinée, un Développeur passe la main sur un agent fraîchement construit qui a besoin d'un tag de connaissances et de quelques prompts de démarrage ; tu ouvres l'agent dans **Agents**, pointes son savoir vers le bon dossier tagué à l'équipe et ajoutes les prompts. Plus tard, une équipe produit laisse tomber un nouveau PDF tarifaire dans le chat d'équipe ; tu le téléverses dans la vue **Documents** et tu le tagues pour que le bon agent le récupère au prochain message.

Les pages ci-dessous sont rangées dans l'ordre que la journée demande — d'abord les connaissances parce que toute autre surface en dépend, puis les surfaces humain-dans-la-boucle, puis les agents parce que les régler, c'est l'endroit où la curation rencontre le comportement.

## Pages dans cette section

- **[Base de connaissances](/fr/platform/workspace/knowledge-base)** — téléverser, modifier, taguer et retirer des documents ; la surface d'où vient chaque réponse groundée.
- **[Crawling de site](/fr/platform/knowledge/crawling)** — pointer Tale sur un site, planifier les re-crawls, regarder l'indexeur remplir la base de connaissances.
- **[Données structurées](/fr/platform/knowledge/structured-data)** — produits, clients, fournisseurs ; les lignes contre lesquelles les agents groundent quand une réponse demande plus qu'un document.
- **[Conversations](/fr/platform/workspace/conversations)** — threads clients partagés. Répondre, fermer, rouvrir, archiver ou marquer comme spam.
- **[Approbations](/fr/platform/workspace/approvals)** — sorties d'automatisations qui attendent un verdict humain ; approuve ou refuse et le workflow continue.
- **[Agents](/fr/platform/agents/create)** — créer, modifier et publier les agents que le reste de l'équipe choisit dans le chat.
- **[Versions d'agent](/fr/platform/agents/versions)** — itérer sur un agent en production sans casser les conversations et automatisations qui l'utilisent déjà.

## Ce que les Éditeurs ne peuvent pas faire

Créer ou modifier des automatisations, configurer intégrations et serveurs MCP, générer des clés API et toute paramètre à l'échelle de l'organisation (membres, image de marque, gouvernance, fournisseurs) sont réservés aux Développeurs et aux Admins. Si tu as besoin de l'un d'eux, demande à quelqu'un avec le bon rôle — construire un agent sans Éditeur dans l'équipe est plus dur que l'inverse.

## Par où commencer

Si tu prends le siège aujourd'hui, le plus petit pas utile est d'ouvrir la [base de connaissances](/fr/platform/workspace/knowledge-base), de téléverser un document que l'équipe référence déjà tous les jours et de vérifier que l'IA peut répondre à une question à partir de lui. À partir de là, [Construire ton premier agent de bout en bout](/fr/tutorials/editor/first-agent-end-to-end) est le tutoriel qui ferme la boucle entre connaissances curées et une surface IA qui s'en sert.
