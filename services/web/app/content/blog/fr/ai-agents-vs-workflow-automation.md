---
title: "Faut-il un agent IA ou un workflow pour cette tâche ?"
description: "Choisis des étapes fixes, un appel au modèle ou un agent pour ton rapport. Garde des calculs fiables et réserve l’enquête aux questions encore ouvertes."
slug: ai-agents-vs-workflow-automation
topicId: T03
reviewed: '2026-10-03'
draft: false
coverAlt: "Un parcours fixe et un parcours à embranchements convergent vers un livrable commun."
---

Utilise un workflow fixe quand tu peux définir les étapes et les règles de décision à l’avance. Choisis un agent s’il doit examiner un résultat, puis décider quoi vérifier ou faire ensuite. Pour résumer un texte fourni, un seul appel au modèle peut suffire.

Ces approches peuvent coexister dans le même processus. Un rapport mensuel peut suivre des étapes fixes pour calculer les totaux, utiliser un modèle pour résumer les commentaires et confier à un agent l’analyse d’une variation inexpliquée. Détermine ce que chaque partie doit accomplir avant de choisir l’architecture.

## Qui choisit l’étape suivante ?

Un workflow suit les étapes et les embranchements que tu définis. Un agent choisit sa prochaine action parmi les possibilités qui lui sont données. La différence porte sur le contrôle du déroulement, pas sur la présence ou l’absence d’IA dans le processus. C’est aussi la distinction retenue dans le [guide d’Anthropic sur la création d’agents](https://www.anthropic.com/engineering/building-effective-agents).

Un workflow peut inclure une étape utilisant un modèle de langage. « Classe ces commentaires, puis résume-les » reste une séquence prédéfinie, même si le classement peut varier ou être erroné. Un ordre d’exécution fixe ne rend pas le contenu généré exact.

Un agent n’a pas non plus besoin de piloter toute la tâche. Tu peux lui confier une recherche tout en gardant des étapes définies pour les calculs, les modifications de données et la diffusion.

![Un workflow fixe suit des étapes prédéfinies, un agent choisit ses actions selon ses observations et un processus hybride place une recherche délimitée entre validation et revue.](/blog/diagrams/fr/T03-diagram.svg)

## Examine un rapport mensuel de retours clients

Prenons un exemple. Une équipe reçoit 22 lignes de retours. Deux reprennent un identifiant déjà présent. Selon la règle convenue, qui conserve une ligne par identifiant, il reste 20 retours distincts.

Huit sont déjà classés dans la catégorie configuration. Le mois précédent, cette catégorie comptait quatre retours sur 20. Sa part dans les retours enregistrés est donc passée de 20 % à 40 %, soit une hausse de 20 points de pourcentage.

Ce sont des calculs, pas des décisions à laisser à un agent. Une étape définie peut valider les identifiants, appliquer la règle sur les doublons, compter les catégories et conserver les lignes exclues. Si deux versions d’un même identifiant se contredisent, soumets ce cas au responsable du rapport plutôt que d’en choisir une sans le signaler.

La suite dépend de la question que cette personne veut résoudre :

| Résultat demandé | Données disponibles | Approche de départ | Pourquoi |
| --- | --- | --- | --- |
| Donner les effectifs par catégorie | Lignes validées et règles de comptage convenues | Workflow fixe | Les opérations sont déjà connues |
| Résumer les huit commentaires sur la configuration | Ensemble complet des commentaires | Un appel au modèle, suivi d’une vérification | Il n’y a pas d’autres sources à choisir |
| Chercher des explications possibles à la hausse | Commentaires et autorisation de consulter les références produit | Agent avec une mission délimitée ou personne | Les constats déterminent la source à consulter ensuite |

La troisième option n’est utile que si des recherches supplémentaires peuvent changer la réponse. Si les preuves pertinentes tiennent déjà dans un court dossier, ajouter une boucle avec des appels d’outils peut apporter peu de choses.

## Donne un objectif précis à la recherche

Supposons qu’une première lecture relève trois plaintes sur les invitations, deux sur l’authentification unique, deux sur l’importation et un commentaire ambigu. Les plaintes sur les invitations orientent vers la référence des permissions ; celles sur l’authentification suggèrent de vérifier une note de version. Des constats différents conduisent à des sources différentes.

C’est une tâche plausible pour un agent. La consigne pourrait être :

> Analyse les huit commentaires sur la configuration à l’aide des références produit et des notes de version fournies. Présente des explications possibles avec les identifiants des retours, les passages qui les étayent et les faits manquants. Conserve les décomptes validés. Demande au responsable du rapport si tu as besoin de données de compte indisponibles. Ne modifie pas les enregistrements et ne publie pas le rapport.

L’agent peut recommander de vérifier les instructions d’invitation sans attribuer la même cause aux huit commentaires. Deux plaintes sur l’authentification et une nouvelle version le même mois ne prouvent pas que cette version a causé la hausse.

De même, « 40 % des retours enregistrés concernent la configuration » ne doit pas devenir « 40 % des clients ont du mal à configurer le produit ». L’export ne dit pas quelle part de tous les clients est concernée. Vérifie l’explication proposée à partir des données d’origine, pas seulement de la qualité de sa présentation.

## Teste l’approche la plus simple qui répond à la demande

Essaie un petit exemple avant de construire tout le processus. Inclus une entrée ordinaire, un doublon contradictoire et une référence manquante. Vérifie que les décomptes restent exacts, que les questions non résolues restent visibles et que le résultat répond à la demande.

Si un seul appel au modèle produit une explication suffisante à partir du dossier fourni, garde cette approche. Si l’agent trouve des preuves utiles qui manquaient au dossier, compare cet apport avec les appels d’outils et le travail de vérification supplémentaires. Une personne peut rester mieux placée pour enquêter si des preuves essentielles sont inaccessibles ou invérifiables.

Pour un processus récurrent, répète des cas représentatifs au lieu de te fier à une seule exécution réussie. Note les échecs et les corrections nécessaires pour obtenir un rapport utilisable. La [fiche de choix du processus](/blog/worksheets/fr/T03-process-decision.md) aide à consigner la décision et ce qui te ferait la reconsidérer.

Tale propose une étape `llm` pour un appel unique au modèle et une étape `agent` pour les travaux qui nécessitent des outils, des fichiers ou plusieurs échanges. Les [concepts d’automatisation](https://docs.tale.dev/fr/platform/automations/concepts) décrivent leur comportement actuel.
