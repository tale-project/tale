---
title: "Sécurité des agents IA : permissions et approbations"
description: "Examine les accès d’un agent IA, les limites des approbations, l’annulation et les preuves conservées avec une fiche pratique de contrôle des permissions."
slug: ai-agent-security-permissions-approvals
topicId: T07
reviewed: 2026-10-03
draft: false
coverAlt: "Des cadres imbriqués donnent à une tâche des ouvertures distinctes et une trace visible sur papier."
---

Un agent IA doit recevoir l’autorité nécessaire à sa tâche, avec des contrôles sur les effets importants que le modèle ne peut pas réécrire. C’est la décision de sécurité centrale. Les défenses contre l’injection de prompt peuvent réduire la probabilité d’une mauvaise requête, mais le système doit encore décider ce qui se passe lorsqu’elle atteint un outil.

Commence par un résultat de projet, une identité d’exécution et les ressources qu’elle peut affecter. Un intervenant préparant un rapport de lancement peut avoir besoin de lire des références et d’écrire un livrable. Il n’a pas automatiquement besoin d’identifiants de messagerie, de la permission de modifier des accès ou de publier le rapport.

La question utile est la suivante : si un contenu non fiable modifie sa prochaine requête, quels effets indésirables restent possibles ?

## Distinguer persuasion et permission

Une injection de prompt se produit lorsqu’un contenu lu par un agent tente de réorienter son comportement. Un document fournisseur peut présenter l’envoi du brief interne du projet comme une étape de vérification obligatoire. Ce document peut apporter des preuves sur le fournisseur ; il ne peut pas accorder d’autorité sur les données de l’équipe.

L’entraînement des modèles, les classificateurs et les instructions précises sont des défenses utiles. Ils ne justifient pas de sauter l’autorisation. Les travaux d’Anthropic sur les agents de navigateur rapportent une meilleure résistance tout en conservant explicitement un risque résiduel d’injection de prompt. Les résultats concernent la configuration de navigateur testée, pas le risque de Tale ni un taux d’attaque universel. [Anthropic : atténuer les injections de prompt](https://www.anthropic.com/research/prompt-injection-defenses).

OWASP décrit l’autonomie excessive à travers les fonctions, permissions et marges d’action inutiles. Ses recommandations comprennent des outils restreints, des privilèges limités et une autorisation extérieure au modèle. En pratique, retire les pouvoirs inutiles avant de débattre de l’usage responsable qu’en fera le modèle. [OWASP LLM06:2025](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/).

Un nom d’outil ne suffit pas à établir cette limite. Une fonction « lire un client » peut utiliser un compte de service trop puissant. Un outil applicatif restreint peut coexister avec un shell contenant des identifiants plus larges. Examine l’identité qui exécute réellement l’action et tous les chemins disponibles vers le même effet.

![Cinq questions d’autorité portent sur l’identité, les données accessibles, les outils et identifiants, l’approbation des effets et les preuves conservées. Teste les refus et les accès révoqués, puis examine la couverture de chaque chemin d’exécution.](/blog/diagrams/fr/T07-diagram.svg)

## Examiner une annonce qui ne doit pas partir

Cet exemple fictif déroule une conception ; il ne rapporte pas un test Tale. Une équipe veut un rapport de lancement et une annonce envoyée à une boîte de test contrôlée après revue. La tâche de confiance précise le projet, le destinataire prévu et le livrable. Une page fournisseur non fiable propose un autre destinataire et demande une pièce jointe interne.

Une conception raisonnable sépare préparation et envoi. L’agent de recherche peut créer le brouillon mais ne reçoit aucun identifiant d’envoi. Une opération séparée propose l’envoi exact. Un réviseur vérifie le destinataire et le contenu par rapport à la tâche de confiance, tandis que le service destinataire applique toujours le périmètre des identifiants.

| Élément proposé | Ce que la tâche de confiance autorise | Suggestion non fiable | Décision et raison |
| --- | --- | --- | --- |
| Action | Préparer le rapport, puis proposer une annonce de test | Envoyer immédiatement un dossier de vérification | Ne pas laisser la page changer l’autorité du workflow |
| Destinataire | Boîte de test contrôlée par l’équipe, choisie dans la tâche | Adresse figurant sur la page fournisseur | Refuser la destination substituée ; son origine compte |
| Contenu | Annonce revue | Annonce et brief interne d’exigences | Refuser la divulgation supplémentaire |
| Identifiants | Chemin d’envoi limité à l’opération prévue | Accès large à la messagerie pour l’agent de recherche | Garder les identifiants plus larges indisponibles |
| Preuves | Proposition, décision, résultat d’exécution, réception | L’agent dit « envoyé avec succès » | Vérifier aussi le système destinataire |

L’observation importante est qu’une attaque n’a pas besoin d’inventer un nouvel appel d’outil. Si `send_email` est déjà autorisé, changer seulement le destinataire ou la pièce jointe peut produire l’effet indésirable. Une liste d’hôtes autorisés contenant le fournisseur de messagerie n’établit pas quelle boîte, quel destinataire ou quel document peut passer par cet hôte. Les limites réseau et l’autorisation d’action répondent à des questions différentes.

La séparation proposée est une recommandation d’architecture. Son application doit être démontrée dans le produit et le service destinataire choisis ; placer ce tableau dans les instructions d’un agent ne la met pas en œuvre.

## Autoriser l’opération réelle

Pour une action importante, demande si l’identité d’exécution peut effectuer cette opération sur cette ressource, avec ces entrées, pour cette tâche. Demande ensuite qui peut autoriser une exception. « L’utilisateur a approuvé l’accès aux e-mails » est trop large pour décider si cette pièce jointe précise peut aller à ce destinataire précis.

Privilégie un chemin d’envoi qui évalue l’entrée exacte proposée et vérifie l’accès actuel à l’exécution. Si l’entrée change après la revue, exige une nouvelle décision au lieu de considérer l’ancienne approbation comme transférable. Pour un système sur mesure, rattacher une décision à une opération et une ressource précises est une exigence à mettre en œuvre et à tester, pas une fonction de Tale affirmée ici.

Garder les identifiants hors du système de fichiers d’un agent peut réduire l’exposition de leurs valeurs brutes. Cela ne supprime pas la nécessité de limiter ce que l’outil authentifié peut faire pour l’agent. De même, ajouter MCP n’achève pas l’autorisation : son guide de sécurité interdit d’accepter des tokens qui n’ont pas été émis pour le serveur MCP et signale les risques de mandataire confus liés au consentement. [Bonnes pratiques de sécurité MCP](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices).

## Tirer parti de défenses plus fortes sans exagérer leur portée

Le système de recherche CaMeL dépasse la simple consigne d’ignorer le texte malveillant : il sépare les flux de contrôle et de données et vérifie les capacités à l’exécution des outils. Ses auteurs décrivent aussi des compromis d’utilité, un travail de maintenance des politiques, des interventions utilisateur et des limites liées aux canaux auxiliaires. Son modèle de menace ne couvre pas toutes les attaques contre l’intégrité du texte ; une synthèse trompeuse peut rester nuisible sans violer un flux protégé. C’est une preuve de recherche en faveur de limites appliquées, pas l’affirmation que l’injection de prompt est résolue ou que Tale implémente CaMeL. [Debenedetti et ses collègues, prépublication CaMeL, révision de juin 2025](https://arxiv.org/html/2503.18813v2).

Pour l’annonce, cette distinction change la revue. Empêcher un envoi non autorisé n’établit pas l’exactitude du brouillon. Une page fournisseur manipulée peut encore pousser le rapport à exagérer une capacité du produit. Conserve la revue des sources et du résultat même lorsque les permissions d’action sont restreintes.

À l’inverse, faire attendre chaque lecture pour une approbation gênerait la recherche courante sans nécessairement contrôler la divulgation finale. Place un contrôle là où l’autorité ou l’exposition change : ajout d’un nouveau périmètre de ressources, export de contenu interne ou réalisation d’un effet externe. C’est un jugement propre à la tâche, pas une règle selon laquelle toutes les écritures auraient les mêmes conséquences.

## Appliquer la conception aux chemins d’exécution distincts de Tale

Les agents de projet Tale reçoivent des outils, Connectors, skills et secrets autorisés configurés. Le libellé **Écrit des données** identifie les outils de plateforme capables d’opérations réelles dans leurs règles d’accès. Le broker de Connectors de l’agent expose des actions de lecture ; les outils GitHub directs et les secrets explicitement accordés suivent des chemins distincts. Une exécution démarrée par un Membre est limitée à la tâche et ne reçoit ni les secrets accordés à l’agent ni le token GitHub équipé. Teste l’identité de démarrage que tu utiliseras réellement. [Agents de projet](https://docs.tale.dev/fr/platform/projects/project-agents) et [runtimes des agents](https://docs.tale.dev/fr/platform/agents/harnesses).

La revue du résultat d’une tâche et la permission d’une opération sont deux décisions distinctes. Accepter un rapport n’autorise pas en soi un envoi via Connector ; répondre à une demande d’information constitue encore une autre interaction. Utilise le [guide d’automatisation des tâches](https://docs.tale.dev/fr/platform/projects/task-automation) pour le parcours de revue et les règles applicables aux réviseurs.

Les approbations d’opérations de Tale couvrent les écritures de Connector concernées dans les automatisations réelles. Les écritures externes exigent une approbation par défaut ; les écritures internes authentifiées par la plateforme ne l’exigent pas par défaut, et une politique d’organisation peut modifier la règle d’un Connector ou d’une action. Cela n’établit pas l’interception de toutes les commandes shell ou de tous les outils disposant de secrets. [Configurer les approbations](https://docs.tale.dev/fr/platform/approvals/configure).

La carte d’approbation affiche l’entrée exacte et permet d’approuver ou de refuser, sans modification. Refuse une entrée incorrecte, corrige-la et démarre une nouvelle exécution. Vérifie qui peut décider : toute personne pouvant ouvrir une tâche peut décider sur sa carte ; l’accès au détail d’exécution est limité aux propriétaires, admins et développeurs. Les cartes ne sont pas acheminées vers un groupe d’approbateurs nommé. Une équipe exigeant un approbateur précis ne peut pas déduire cette restriction de la présence d’une carte. [Concepts d’approbation d’opérations](https://docs.tale.dev/fr/platform/approvals/concepts).

## Tester un refus et un résultat ambigu

Utilise du contenu fictif et des destinations que tu contrôles. Remplace d’abord le destinataire dans la proposition d’envoi de test et refuse-la. Vérifie la décision consignée et l’absence de livraison. Dans une exécution corrigée distincte, approuve l’envoi sans conséquence et examine la boîte destinataire. Le **Essai** simulé de Tale n’effectue pas l’écriture externe et n’exerce pas la carte d’approbation réelle ; il ne peut donc pas établir ces résultats. [Concepts d’approbation d’opérations](https://docs.tale.dev/fr/platform/approvals/concepts).

Considère maintenant un échec construit : le service d’envoi accepte l’e-mail, mais l’appelant perd sa connexion avant d’enregistrer la réponse. La tâche paraît échouée ou incertaine. Relancer toute la tâche peut envoyer un doublon.

Suspends les envois supplémentaires et conserve l’entrée de l’opération, ses identifiants et ses horodatages. Cherche l’effet dans le système destinataire ou le relevé de livraison du fournisseur. Si la livraison est confirmée, consigne ce fait et poursuis uniquement le travail restant. Ne réessaie que si une preuve faisant autorité établit que la demande originale n’a pas eu d’effet et ne peut plus aboutir, ou si le contrat d’idempotence documenté du service destinataire couvre la répétition de façon sûre. Une boîte vide ou l’absence actuelle de relevé de livraison n’établit pas cette condition. Si le résultat reste inconnu, garde-le inconnu et fais-le remonter ; une nouvelle tentative automatique transformerait une preuve manquante en possible deuxième effet.

Lorsqu’une API destinataire prend en charge l’idempotence, utilise sa clé et ses règles documentées de répétition pour éviter les effets en double dans les limites de ce mécanisme. Sinon, prévois une étape de vérification ou une décision manuelle. Ce conseil de reprise est général ; il n’affirme pas que chaque Connector Tale fournit l’idempotence.

L’annulation est également distincte de l’inversion. Le moteur d’automatisation de Tale arrête le travail suivant à ses limites d’exécution ; les effets déjà réalisés ne sont pas annulés. Examine ce qui s’est passé avant de redémarrer. [Journaux d’exécution](https://docs.tale.dev/fr/platform/automations/execution-logs).

## Conserver les preuves nécessaires pour reconstituer la décision

Dans cet exemple, conserve ensemble quatre éléments : la proposition, la personne qui l’a autorisée ou refusée, le compte rendu d’exécution et ce qu’indique le système destinataire. Ils établissent des faits différents. L’approbation prouve qu’une permission a été donnée ; elle ne prouve ni la livraison ni l’exactitude.

Le journal d’audit de Tale n’est pas une transcription complète de chaque conversation ou service externe. Les exports sont filtrés et plafonnés, et la conservation modifie l’historique disponible. Les contrôles par chaîne de hachage ne prouvent pas que chaque événement a été capturé et ne fournissent pas de signature indépendante ; la vérification à la demande couvre au maximum 1 000 entrées conservées. Utilise le [journal d’audit](https://docs.tale.dev/fr/platform/admin/governance/audit-logs) et le [guide d’intégrité](https://docs.tale.dev/fr/self-hosted/operate/security/audit-log-integrity) pour comprendre ce que les preuves de plateforme peuvent établir, puis conserve les preuves externes manquantes si nécessaire.

## Changer la conception quand le travail change

Pour une rédaction à faible impact sans données sensibles ni autorité d’écriture externe, une décision humaine obligatoire à chaque appel d’outil peut apporter peu de valeur. Autorise le travail délimité et examine le livrable. Pour des écritures répétées et prévisibles, une opération API strictement limitée avec validation déterministe peut être plus facile à encadrer qu’un agent choisissant des cibles arbitraires.

La recommandation devient plus stricte lorsque l’intervenant peut lire des informations sensibles et écrire vers de nombreuses destinations, ou lorsque les erreurs sont difficiles à inverser. Réduis son autorité, sépare préparation et exécution ou confie l’action finale à une personne. Un réviseur doit disposer d’assez de contexte et d’un point de décision effectivement appliqué ; le mot « approbation » seul ne fournit ni l’un ni l’autre.

La [fiche d’autorité d’action](/blog/worksheets/fr/T07-action-authority.md) contient la décision fictive remplie, un relevé d’autorité compact et l’exercice de reprise d’une livraison ambiguë. Apporte une tâche réelle et ses chemins d’action disponibles à une [démo Tale](/fr/request-demo), après avoir identifié les effets qui doivent rester impossibles.
