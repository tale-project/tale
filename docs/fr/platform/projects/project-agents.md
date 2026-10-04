---
title: Créer et gérer des agents de projet
description: Configure un agent réutilisable, accorde son équipement et démarre une tâche dont tu peux vérifier le résultat.
---

Crée un agent de projet pour disposer d’un agent réutilisable sur les tâches du projet. Il associe un environnement de code, un modèle, des instructions et un équipement autorisé. Tu dois pouvoir modifier le projet actif. Les Membres voient les agents du projet dans son onglet **Agents**, qui leur indique de demander un nouvel agent à un Éditeur ou à un Admin. Tant qu’un projet n’a pas d’agents propres, ses tâches peuvent aller à l’[agent standard](#standard-agent) de l’organisation. Seuls un Propriétaire ou un Admin peuvent changer les secrets accordés.

## Préparer la première tâche

Choisis un résultat limité, comme vérifier les approbations manquantes dans un brief de lancement. L’agent nécessite des [identifiants de fournisseur](/fr/platform/admin/providers) compatibles et une [sandbox](/fr/platform/admin/sandboxes) disponible. Enregistrer sa configuration ne prouve pas encore qu’une exécution réussira.

Sépare les instructions réutilisables de la tâche. « Repère les preuves manquantes et indique les contrôles effectués » appartient à l’agent. Le document, la date de revue et les critères d’acceptation appartiennent à la tâche.

<Frame caption="L'onglet Agents — les agents du projet ; chaque ligne nomme le harness, le fournisseur et le modèle.">

![L’onglet Agents du projet Website relaunch listant deux agents nommés — Content editor sur Claude Code et Redirect auditor sur Codex — chaque ligne nommant le fournisseur et l’identifiant du modèle, à côté du bouton Nouvel agent.](/images/platform/project-agents-models.webp)

</Frame>

## Configurer l’agent

<Steps>

<Step title="Choisir un nom et un environnement">

Ouvre l’onglet **Agents** du projet et choisis **Nouvel agent**. Donne-lui un **Nom** reconnaissable, puis choisis le **Harness**, son [environnement de code](/fr/platform/agents/harnesses). Les noms sont uniques dans le projet, qui accepte jusqu’à 50 agents.

Tu peux aussi partir d’une tâche : tant que le projet n’a pas d’agent, **Créer un agent…** sous **Assigné à** ouvre **Nouvel agent** par-dessus la tâche et lui assigne l’agent que tu crées.

</Step>

<Step title="Choisir le modèle et le fournisseur">

Recherche un **Modèle** par nom ou identifiant API. Le même modèle peut apparaître une fois par fournisseur : lis le fournisseur de l’entrée avant de la choisir. Cela fixe la combinaison pour les prochaines exécutions. Les offres par abonnement n’apparaissent qu’avec un environnement compatible, et un modèle qui n’appelle des tools que via l’API Responses d’OpenAI, comme GPT-6.1 Sol, n’apparaît qu’avec Codex.

Une ancienne configuration peut nommer un modèle sans fournisseur fixé. Le dialogue indique alors quel fournisseur le servirait actuellement ou pourquoi aucun ne peut le faire. Choisis une entrée pour fixer ce choix.

</Step>

<Step title="Accorder l’équipement et écrire les instructions">

Sous **Skills, connectors & outils**, ajoute les bundles, services et opérations nécessaires. Pour un nouvel agent, les skills de documents `docx`, `pptx`, `xlsx` et `pdf` sont cochés s’ils sont accessibles au projet. Ils contiennent des consignes pour travailler avec des fichiers Word, PowerPoint, Excel et PDF. Décoche ceux dont l’agent n’a pas besoin. La modification d’un agent existant conserve son équipement enregistré. La liste de skills suit les accès des équipes du projet, pas seulement ta visibilité personnelle. Un skill absent peut donc demander une modification de son partage.

<Frame caption="Le menu Skills d’un nouvel agent, avec les skills de documents déjà activés ; chaque skill indique qui l’a créé.">

![La boîte Nouvel agent avec le menu Skills ouvert : docx, pdf, pptx et xlsx sont activés et marqués Fourni avec Tale, tandis que brief-summary et release-notes par Alex Rivera ainsi que visual-aspect-analyzer restent désactivés.](/images/platform/project-agent-document-skills.webp)

</Frame>

Lis **Écrit des données** avant d’accorder un outil d’écriture : il autorise des opérations réelles selon ses règles d’accès. Le broker de connectors ne propose que des lectures aux agents. Les outils GitHub directs et les secrets explicitement accordés suivent d’autres voies.

**Modifier la priorité et l'agent assigné aux tâches** permet à un agent de projet de prioriser les tâches existantes, de les assigner à un agent du même projet ou de retirer leur assignation, sans démarrer de travail. Cette autorisation reste désactivée tant que tu ne l’accordes pas et n’est pas proposée aux nœuds agent des automatisations. L’agent doit d’abord lire la tâche et joindre les valeurs lues à sa demande de modification. Si ces valeurs ont changé entre-temps, toute la demande est refusée et il doit relire la tâche. Un changement d’assignation exige une tâche ouverte, sans exécution active, revue en attente ou question ouverte. Modifier uniquement la priorité conserve ces passages de relais. Le Tool ne change ni le statut ni le réviseur, ne répond à aucune question destinée à une personne et ne lance aucune exécution. Seule une exécution active disposant de droits sur tout le projet peut l’utiliser, pas une exécution démarrée par un Membre.

**Revoir les résultats des tâches d’autres agents** autorise un relecteur désigné à décider d’un résultat terminé produit par un autre agent de projet. Cette permission est désactivée au départ et n’est pas proposée aux nœuds agent des automatisations. Choisir un agent comme relecteur ne lui accorde pas cet outil et ne démarre aucune exécution. Il relit depuis sa propre tâche, avec des droits actuels sur tout le projet et la permission de relecture toujours accordée. Sa décision enregistre un retour et des éléments de vérification : une approbation termine la tâche examinée, tandis qu’une demande de modifications la remet à **À faire** sans démarrer de travail. Les compétences humaines requises et les approbations de workflows restent protégées. [Configurer un relecteur indépendant](/fr/platform/projects/task-automation#agent-review) décrit le parcours complet.

**Lancer d'autres agents sur des tâches** permet à l’agent de mettre au travail un autre agent de ce projet, par exemple un agent coordinateur qui distribue le travail prêt et relance un agent après avoir répondu à sa question. Il désigne une tâche, éventuellement l’agent à qui l’assigner, et un message que l’exécution lancée traite en premier. L’exécution lancée agit pour le compte de la même personne que l’exécution du coordinateur, et elle désigne le coordinateur comme l’agent qui l’a lancée. Un agent lancé de cette façon ne peut pas lancer d’autres agents, une exécution démarrée par un Membre ne peut en lancer aucun, et ni un agent qui travaille déjà sur une autre tâche ni une tâche bloquée par une tâche ouverte ne sont lancés. N’accorde cet outil qu’à un agent dont les instructions précisent quel travail il peut distribuer ; l’[automatisation des tâches](/fr/platform/projects/task-automation#travail-lance-par-une-automatisation-ou-un-autre-agent) décrit ce qu’une telle exécution peut faire.

Les appels de connecteurs d’une exécution se font au nom du membre qui l’a démarrée, que ce soit avec **Démarrer l'agent**, **Relancer**, un passage à **En cours** ou une mention de l’agent avec @. Ils utilisent les [identifiants des connecteurs](/fr/platform/admin/connectors) de l’organisation et sont enregistrés au nom de ce membre. Si ce membre quitte l’organisation ou est désactivé, les appels sont refusés : utilise **Annuler l'exécution** (ou laisse l’exécution se terminer), puis redémarre-la pour qu’elle se fasse en ton nom. Quand un commentaire relance l’exécution pour la guider, comme le font tous les environnements sauf Claude Code, les appels se font ensuite au nom de l’auteur du commentaire.

Rédige des **Instructions** qui définissent responsabilité, preuves et limites. Pour la revue du lancement : « Lis le brief fourni. Signale les approbations manquantes et les dates contradictoires avec le passage correspondant. Ne termine pas la tâche. »

</Step>

<Step title="Vérifier et enregistrer">

Si le travail demande des **Secrets**, un Propriétaire ou Admin accorde des identifiants nommés de l’organisation. L’agent en cours peut lire leurs valeurs : utilise des jetons limités et remplaçables. Modifier une valeur partagée affecte aussi les autres agents et nœuds de workflow qui utilisent ce nom. Une exécution qu’un Membre démarre ne reçoit aucun de ces secrets, ni le jeton d’une connexion GitHub équipée : un Éditeur ou un rôle supérieur doit démarrer le travail qui en a besoin.

Choisis **Créer l'agent**. Vérifie l’environnement, le fournisseur et le modèle de la nouvelle ligne. Rouvre l’agent pour examiner l’équipement et les instructions enregistrés.

</Step>

</Steps>

## Affecter et démarrer le travail

Ouvre une tâche du même projet, affecte-la à l’agent et choisis **Démarrer l'agent**. L’affectation et l’exécution sont deux actions distinctes. Fournis les fichiers et les critères d’acceptation avant le démarrage. Il n’est pas nécessaire de pouvoir modifier le projet : un Membre fait travailler un agent sur les tâches qu’il a créées ou qui lui sont attribuées, un Éditeur ou un rôle supérieur sur n’importe quelle tâche du projet. Une exécution qu’un Membre démarre s’en tient à cette tâche, sans les secrets de l’agent et dans un espace de travail à part ; [Exécutions démarrées par un Membre](/fr/platform/projects/tasks#executions-demarrees-par-un-membre) détaille ce qui change.

Le compte rendu apparaît dans les commentaires et les fichiers collectés sont joints comme résultats. Si un admin a activé la [génération d’images](/fr/platform/admin/governance/content-models#let-agents-generate-images), l’agent peut aussi créer des images pour la tâche ; elles apparaissent parmi les fichiers produits et comptent pour le membre qui a lancé l’exécution. Après un travail réussi, la tâche passe **En revue** pour que le relecteur humain ou l’agent relecteur indépendant désigné l’évalue. Mentionne l’agent dans un commentaire pour guider ou poursuivre le travail. Le harness détermine si le message rejoint le processus actif ou lance une continuation.

L’[automatisation des tâches](/fr/platform/projects/task-automation) explique le suivi, l’arrêt et la revue. L’assistant de chat ordinaire reste distinct, même avec un contexte de projet.

## L’agent standard {#standard-agent}

Un projet sans agents propres peut quand même confier du travail à un agent. Sauf si un Admin l’a désactivé dans [Gouvernance > Modèles](/fr/platform/admin/governance/content-models#standard-agent), **Assigné à** y propose l’option **Agent standard**, à toutes les personnes qui peuvent assigner la tâche, Membres compris. La première fois que quelqu’un la choisit, Tale met l’agent en place dans le projet et lui assigne la tâche. Tu le démarres ensuite comme n’importe quel autre agent, ou tu le mentionnes dans un commentaire. S’il ne peut pas démarrer pour toi, le champ de commentaire te le signale, et ton commentaire est enregistré comme une simple mention.

<Frame caption="L’onglet Agents d’un projet dont les tâches vont à l’agent standard.">

![L’onglet Agents du projet Customer onboarding portal avec une seule ligne : l’agent standard avec le badge Standard, Claude Code, OpenRouter, le modèle anthropic/claude-haiku-4.5 et quatre équipements. Une note indique que Tale l’a mis en place pour ce projet et que son harness, son modèle et ses instructions suivent les réglages de l’organisation. La ligne a un bouton de suppression, mais aucun bouton de modification.](/images/platform/project-agents-standard.webp)

</Frame>

L’onglet **Agents** l’affiche avec le badge **Standard**. Personne ne le modifie : son harness, son modèle et ses instructions suivent les réglages de l’organisation, relus à chaque démarrage d’une exécution, et son équipement se limite aux skills de documents `docx`, `pptx`, `xlsx` et `pdf` que le projet peut utiliser au démarrage d’une exécution. Si un admin en désactive un, il disparaît de son équipement au lieu de bloquer l’agent. Sur **Automatique**, chaque exécution utilise un modèle que la personne qui la démarre peut utiliser ; il peut donc fonctionner avec des modèles différents selon les personnes.

Pour donner au projet un agent propre, choisis **Nouvel agent**. Dès lors, le projet ne propose plus l’agent standard ; celui déjà mis en place reste assignable jusqu’à ce que tu le supprimes. Sa suppression conserve l’historique de ses tâches, et tant que le projet n’a pas d’agents, la prochaine tâche confiée à l’agent standard le remet en place.

## Modifier ou retirer un agent

Quand tu modifies un agent existant, Tale vérifie à l’enregistrement que ses paramètres n’ont pas changé depuis son ouverture. Si quelqu’un a enregistré avant toi, ton enregistrement est refusé et tes modifications non enregistrées restent dans le dialogue. Copie celles que tu veux garder avant de le fermer, puis rouvre l’agent pour charger les paramètres actuels et y intégrer tes modifications avant d’enregistrer à nouveau.

Utilise le menu de sa ligne pour le modifier ou le supprimer. L’agent standard n’a que **Supprimer l'agent**. Les changements concernent les prochaines exécutions ; une exécution active conserve sa configuration initiale. La suppression retire les affectations à l’agent mais conserve l’historique des tâches. Elle efface aussi les [espaces de travail de sandbox](/fr/platform/admin/sandboxes#explain-why-a-workspace-disappeared) de l’agent avec leurs fichiers, y compris ceux des Membres. Examine le travail en cours et conserve les résultats nécessaires avant de retirer l’agent concerné.

Si la création échoue, lis la cause affichée : un nom déjà utilisé, un accès au projet manquant, un modèle indisponible et un skill invisible sont des problèmes distincts. Une exécution qui échoue définitivement indique en haut de sa tâche ce qui s’est passé et qui peut y remédier ; [Quand l’agent ne peut pas terminer](/fr/platform/projects/task-automation#quand-lagent-ne-peut-pas-terminer) détaille les cas. Modifier les instructions ne résout pas ces prérequis.
