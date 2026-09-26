---
title: Choisir un environnement d’agent
description: Associe le harness aux identifiants, aux outils et au fonctionnement de la sandbox avant de confier une tâche.
---

Un harness est le programme de code qui exécute la session d’un agent dans une sandbox. Il interroge le modèle, lit et écrit des fichiers, lance des commandes et rend compte du travail. Tu le choisis pour un agent de projet ou un nœud `agent` d’automatisation. Le sélecteur de modèle du chat ordinaire ne choisit pas de harness.

## Choisir l’environnement et vérifier l’accès

Dans l’onglet **Agents** d’un projet, ouvre un agent et choisis son **Harness**. Le nœud agent d’une automatisation utilise le même nom de champ. Choisis ensuite le modèle et le fournisseur. Sous **Paramètres > Fournisseurs IA**, la section **Harnesses** montre les voies d’exécution actuellement disponibles pour l’organisation.

Il faut des identifiants compatibles et de la [capacité de sandbox](/fr/platform/admin/sandboxes). Un modèle qui fonctionne dans Chat ne suffit pas. Si un environnement manque ou ne propose aucun modèle, examine son état et les identifiants du fournisseur avant de modifier la demande de travail.

## Comparer les environnements pris en charge

« Géré » signifie que le programme appelle le modèle via la passerelle de Tale. « Direct » signifie que la session reçoit les identifiants destinés aux outils du fournisseur. Les définitions livrées prennent en charge les combinaisons suivantes ; leur disponibilité dépend du déploiement et des identifiants.

| Harness | Voie d’accès | Nouvelles instructions dans le processus actif | Canal MCP de Tale |
| --- | --- | --- | --- |
| Claude Code | Gérée ou directe | Oui | Oui |
| Codex | Gérée ou directe | Non | Oui |
| Cursor | Directe uniquement | Non | Non |
| Gemini CLI | Gérée ou directe | Non | Oui |
| Hermes | Gérée ou directe | Non | Non |
| OpenClaw | Gérée ou directe | Non | Oui |
| OpenCode | Gérée uniquement | Non | Oui |
| Pi | Gérée ou directe | Non | Non |
| Qwen Code | Gérée ou directe | Non | Oui |

**Claude Code (compact prompt)** est une option pour les workflows ciblés qui fournissent déjà des consignes complètes. Elle raccourcit les instructions intégrées et certaines descriptions d’outils, tout en conservant les outils, les hooks, MCP et les consignes ajoutées par Tale. Vérifie les résultats et la durée avec ton modèle avant de l’adopter : un prompt plus court ne garantit pas une exécution plus rapide. Choisis **Claude Code** pour retrouver le prompt complet à la prochaine nouvelle exécution. Un abonnement fournisseur réservé à Claude Code ne prend pas automatiquement en charge cette variante.

Pour guider le travail, commente la tâche et mentionne son agent. Claude Code reçoit le message entre deux appels d’outils. Pour les autres environnements, Tale arrête le processus et poursuit la même conversation dans un nouveau processus avec ton commentaire. Cela explique un redémarrage du processus après une nouvelle consigne.

## Comprendre les identifiants et les coûts

Avec une clé API stockée ou fournie par l’environnement du déploiement, Tale remet une clé de passerelle limitée à la session. La clé d’origine du fournisseur de modèle reste dans la plateforme. Les appels de passerelle sont mesurés et soumis aux règles de dépense applicables, en tenant compte des montants déjà attribués aux autres échanges en cours.

Les abonnements fournisseurs utilisent leur harness compatible et reçoivent les identifiants d’abonnement dans l’environnement de la session. Ils ne servent pas d’identifiants de chat ordinaire et ne fonctionnent pas avec un harness incompatible. Leurs appels directs échappent à la mesure et aux plafonds de la passerelle Tale. Examine la consommation auprès du fournisseur d’abonnement.

Ces règles sur les identifiants de modèle ne signifient pas que la sandbox ne contient aucun secret. Les **Secrets** explicitement accordés et le jeton d’un accès GitHub équipé peuvent y être disponibles. Limite ces accès aux besoins de la tâche.

## Comprendre les fichiers et les outils connectés

Un agent de projet réutilise son espace de travail persistant entre ses tâches. Les pièces jointes sont accessibles en lecture seule sous `/agent/inputs/<task>/attachments/`. Les fichiers écrits dans `/agent/output/<task>/` sont collectés comme **Fichiers produits** à la fin de l’échange. Un nœud agent collecte sa sortie sous `/agent/output/`.

Les bundles de skills sont préparés sous forme de fichiers et cités dans les instructions de l’exécution. Examine leurs consignes et scripts avant de les accorder. [Skills des agents](/fr/platform/agents/skills) explique cette préparation et la visibilité.

Le broker de connectors garde les identifiants ordinaires dans Tale et renvoie les résultats des actions. Il propose les lectures aux agents et refuse les écritures par cette voie. Utilise un nœud connector d’automatisation pour une écriture soumise aux règles de Tale. Les outils GitHub et les secrets explicitement accordés suivent d’autres voies : la restriction du broker n’interdit donc pas toutes les écritures depuis le shell.

L’accès sortant autorise normalement l’installation de paquets et le clonage de dépôts, tout en bloquant les adresses privées et les services de métadonnées cloud. Les opérateurs peuvent restreindre davantage les hôtes permis. Lorsqu’un service est inaccessible, examine les règles réseau avant de conclure que les identifiants sont incorrects.

## Examiner le résultat

Le programme décide quand son échange est terminé ; Tale collecte le compte rendu et la sortie. Lis les deux avant de terminer la tâche. Vérifie quels contrôles ont réellement été exécutés et quels services manquaient dans la sandbox. L’[automatisation des tâches](/fr/platform/projects/task-automation) explique la revue du travail de projet ; les [journaux d’exécution](/fr/platform/automations/execution-logs) expliquent le résultat d’un nœud agent.

Si le programme ne peut pas démarrer du tout — une configuration qu’il refuse, un répertoire d’état qu’il ne trouve pas —, l’exécution échoue aussitôt et sa cause cite les dernières lignes écrites par le programme : la cause est nommée, pas seulement un code de sortie. Une telle exécution n’est pas relancée automatiquement ; corrige la cause, puis relance-la.
