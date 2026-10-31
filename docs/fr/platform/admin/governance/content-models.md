---
title: Modèles
description: Définis les modèles par défaut, limite leur accès, choisis des modèles distincts pour les images et la transcription audio, et mets en place l’agent standard des projets sans agents.
---

En tant qu’admin ou propriétaire, utilise **Paramètres > Gouvernance > Modèles** pour choisir les modèles proposés au départ et ceux que les membres peuvent utiliser. Les valeurs par défaut orientent le choix ; les règles d’accès imposent une restriction. Configure d’abord les [identifiants fournisseur](/fr/platform/admin/providers) pour rendre les modèles souhaités disponibles.

## Définir un modèle par défaut

1. Sous **Modèles par défaut**, choisis **Ajouter une règle**.
2. Choisis la portée par défaut comme base, un rôle ou une équipe. Sélectionne la cible si nécessaire.
3. Choisis un fournisseur et un modèle, puis **Confirmer**. Enregistre les changements en attente dans l’en-tête.
4. Démarre un chat en tant que membre du groupe cible, avec le modèle sur **Auto**, puis vérifie le modèle effectivement choisi.

Le modèle par défaut s’applique lorsqu’aucun modèle n’a été choisi explicitement. Une règle d’équipe passe avant une règle de rôle, puis vient la valeur par défaut générale ; si une personne appartient à plusieurs équipes dotées d’une règle, la première règle d’équipe correspondante du tableau l’emporte (voir [Comment les règles se combinent](/fr/platform/admin/governance/policies-and-limits#how-rules-combine)). Elle n’empêche pas de sélectionner un autre modèle autorisé.

La liste propose les modèles capables de répondre dans le chat. Un modèle d’images qui ne peut pas utiliser d’outils, comme Gemini 2.5 Flash Image, n’y figure pas, pas plus que dans le sélecteur de modèle du chat : le chat envoie chaque message avec des outils, par exemple une recherche dans les documents. Choisis un tel modèle sous [génération d’images](#let-agents-generate-images), et l’assistant crée des images avec lui.

## Limiter l’accès aux modèles

Sous **Accès aux modèles**, choisis le mode et ajoute des règles pour les personnes, équipes, rôles ou la portée par défaut à couvrir.

Les règles visant une personne, une équipe ou un rôle nécessitent une cible avant confirmation, dans les deux modes. La portée par défaut s’applique à tout le monde et n’a pas besoin de cible. Changer de portée efface la cible précédente ; sélectionne une cible dans la nouvelle portée.

Les anciennes règles enregistrées sans cible restent visibles avec **Cible manquante** et un avertissement : elles ne s’appliquent à personne. Modifie chaque règle concernée pour sélectionner la cible prévue, ou supprime-la. Les modifications ne sont enregistrées que lorsque chaque règle ciblée a une cible ; la dernière correction enregistre la politique corrigée. Tale ne devine pas les cibles et ne supprime pas automatiquement les règles existantes.

| Mode | Effet d’une règle correspondante |
| --- | --- |
| Liste d’autorisation | Seuls les modèles autorisés dans la liste sont utilisables ; un modèle bloqué reste refusé. |
| Liste de blocage | Les modèles sont permis sauf s’ils figurent parmi les modèles bloqués. |

Les règles individuelles passent avant celles des équipes, puis des rôles et enfin la règle par défaut. Plusieurs règles d’équipe correspondantes combinent leurs listes ; un blocage explicite reste prioritaire pour le modèle. Si aucune règle ne correspond, la politique ne restreint pas cette personne. Ajoute une règle de base pour couvrir tout le monde.

Pour le chat, l’accès est vérifié à l’utilisation, même pour un modèle choisi explicitement ou fixé. Le modèle par défaut doit aussi passer cette vérification. S’il est refusé, la sélection automatique peut se rabattre sur un modèle autorisé. L’éditeur signale les contradictions entre modèle par défaut et accès. Corrige-les pour que le modèle par défaut prévu soit réellement utilisé.

<Tip>
Après un changement, teste les deux cas pour le membre concerné : un modèle autorisé doit fonctionner et un modèle interdit doit être refusé. Tester uniquement avec un compte admin ne prouve pas une règle propre à un rôle.
</Tip>

### Ouvrir les modèles de l’organisation aux clés API {#model-endpoints}

**Endpoints de modèles pour les clés API** permet aux personnes autorisées d’utiliser les modèles que cette politique autorise depuis leurs propres outils, comme opencode, Claude Code ou des scripts écrits avec les SDK OpenAI ou Anthropic, avec une clé API personnelle et via des endpoints compatibles OpenAI et Anthropic. Ce réglage est désactivé par défaut. Active l’interrupteur **Endpoints de modèles pour les clés API** ; la modification est enregistrée aussitôt.

- **Qui peut appeler.** Les propriétaires, admins et développeurs par leur rôle. Tout autre membre seulement avec la compétence **Appeler les modèles par l'API**, attribuée dans [Compétences](/fr/platform/admin/governance/competences).
- **Quels modèles.** Les modèles de chat que servent tes identifiants de fournisseur avec clé API ou variable d’environnement, restreints par les modèles autorisés de chaque identifiant. Les règles d’accès ci-dessus s’appliquent à chaque appel, pour la personne dont la clé l’a envoyé. L’interrupteur agit indépendamment de **Activer la politique d'accès aux modèles** : quand cette politique est désactivée, seuls les modèles autorisés des identifiants restreignent la liste.
- **Ce que chaque appel traverse.** Les budgets de [Politiques et limites](/fr/platform/admin/governance/policies-and-limits) et les garde-fous d’entrée de [Garde-fous](/fr/platform/admin/governance/guardrails#model-endpoints). Les réponses des modèles ne sont pas filtrées.
- **Où il apparaît.** Chaque appel est imputé à la personne et à la clé, comme **Appel API direct** dans l’[analyse de l’usage](/fr/platform/admin/governance/usage-analytics).

<Frame caption="Gouvernance > Modèles — les endpoints de modèles pour les clés API, activés.">

![La section Endpoints de modèles pour les clés API de la page Modèles, interrupteur activé, qui explique que les propriétaires, les admins, les développeurs et les membres ayant la compétence Appeler les modèles par l'API peuvent utiliser les modèles de l’organisation depuis leurs propres outils.](/images/platform/governance-model-endpoints.webp)

</Frame>

Désactiver l’interrupteur fait refuser l’appel suivant avec `403 MODEL_API_DISABLED`. [Utiliser Tale depuis ton éditeur ou un script](/fr/develop/use-tale-from-your-editor#model-endpoints) montre aux membres comment connecter leurs outils.

### Traiter les prompts uniquement dans l’UE/EEE {#eu-processing}

**Traiter les prompts uniquement dans l'UE/EEE** maintient les appels de modèles de l’organisation sur des endpoints dont on sait qu’ils traitent les prompts dans l’UE/EEE. L’interrupteur est désactivé par défaut et agit indépendamment de **Activer la politique d'accès aux modèles**.

1. Sous **Endpoints dont le traitement dans l'UE/EEE est confirmé**, indique les hôtes de tes propres endpoints qui y traitent les prompts, un par ligne, tel que chacun figure dans l’URL de base ou l’URL de l’endpoint de son fournisseur : le serveur d’un [fournisseur personnalisé](/fr/platform/admin/providers#definir-un-fournisseur-personnalise), ou une ressource Azure OpenAI dont les déploiements traitent les prompts dans l’UE/EEE, par exemple `my-resource.openai.azure.com`. Choisis **Enregistrer les endpoints**.
2. Active l’interrupteur **Traiter les prompts uniquement dans l'UE/EEE**. La modification est enregistrée aussitôt.

Confirme les hôtes avant d’activer l’interrupteur, pour qu’aucun appel vers eux ne soit refusé entre-temps.

- **Ce qui compte.** Les endpoints dans l’UE des fournisseurs que Tale connaît, `eu.openrouter.ai`, `eu.api.openai.com` et `api.eu.mistral.ai`, et les hôtes que tu confirmes. L’endpoint global d’un fournisseur, comme `openrouter.ai` ou `api.openai.com`, ne compte jamais : l’éditeur ne l’accepte pas et indique à la place l’endpoint du fournisseur dans l’UE. Pour utiliser un tel fournisseur, définis un fournisseur personnalisé dont l’URL de base est son endpoint dans l’UE, par exemple `https://eu.openrouter.ai/api/v1`. Ne confirme une ressource Azure que si ses déploiements sont des déploiements régionaux dans une région de l’UE/EEE ou des déploiements Data Zone UE : un déploiement de type Global peut traiter une requête dans n’importe quelle région.
- **Ce qu’il couvre.** Les réponses du chat et leurs titres, **Améliorer avec l'IA** dans la boîte de réception, les réponses d’un agent dans une tâche quand il travaille avec les outils du chat, les étapes `llm` des automatisations, les embeddings et la recherche dans les documents, la génération d’images, la transcription audio, la sortie vocale et les [endpoints de modèles pour les clés API](#model-endpoints). Sur ces endpoints, un modèle d’un fournisseur du catalogue livré que la passerelle de modèles sert elle-même, comme OpenAI, Azure OpenAI, Mistral ou OpenRouter, est refusé même sur un endpoint dans l’UE, car la passerelle appelle l’endpoint propre au fournisseur : sers plutôt le modèle par un fournisseur personnalisé.
- **Ce qui est refusé.** Un appel vers tout autre endpoint, ou par un fournisseur qui n’en indique aucun, est refusé avant que quoi que ce soit ne soit envoyé. La personne voit pourquoi et ce qu’un admin peut changer, et le refus est consigné dans le [journal d’audit](/fr/platform/admin/governance/audit-logs) comme **Accès au modèle refusé**. Tant que la politique d’accès aux modèles ne peut pas être lue, chaque appel de modèle est refusé jusqu’à ce qu’un admin enregistre une politique valide.
- **Ce qui est proposé.** Tant que l’interrupteur est activé, les sélecteurs de modèle ne proposent que les modèles dont il laisse passer l’endpoint : la liste de modèles du chat et son choix automatique, les sélecteurs de modèle des agents et des automatisations, **Modèles par défaut**, la génération d’images, la transcription audio, le modèle d’embedding dans **Paramètres > Résidence des données** et les modèles des [endpoints de modèles](#model-endpoints). Un sélecteur qui laisse des modèles de côté dit pourquoi. Tant que la politique d’accès aux modèles ne peut pas être lue, ils n’en proposent aucun.
- **Pas encore couvert.** Le sélecteur du modèle qui lit les images propose encore tous les modèles. Le trafic de modèles des environnements d’agent comme Claude Code ou Codex dans une sandbox, et le fournisseur de modération des [garde-fous](/fr/platform/admin/governance/guardrails), n’y sont pas encore soumis.

**Informations sur le message** sous une réponse indique où elle a été traitée lorsque c’est connu ; [Voir comment une réponse a été produite](/fr/platform/chat/basics#reply-details) explique la ligne **Région**.

## Choisir le modèle qui lit les images

Un agent textuel a besoin d’aide pour lire une image, comme une capture d’écran ou une page scannée. La section du modèle de vision choisit celui qui la décrit pour l’agent. Un agent dont le propre modèle lit les images les lit lui-même ; le modèle de vision sert encore les outils d’image que les scripts et agents de code appellent dans leur bac à sable, comme la transcription par lots de pages scannées. Chaque agent géré en reçoit donc un dès qu’un modèle accessible existe.

Laisse la sélection du modèle de lecture sur automatique pour suivre le catalogue disponible. Tale préfère un modèle de vision recommandé, puis une option accessible peu coûteuse. Le texte sous la sélection indique le choix actuel et sa raison.

Fixe un modèle si tu souhaites un choix stable. La sélection propose des modèles capables de lire les images. Si le modèle fixé devient indisponible, rétablis son accès fournisseur ou choisis explicitement **Automatique**, puis enregistre. Tale ne remplace pas silencieusement un modèle fixé. Vérifie le choix après une rotation des identifiants ou un changement de disponibilité.

## Autoriser la génération d’images {#let-agents-generate-images}

La **génération d’images** permet à l’assistant du chat, aux [agents de projet](/fr/platform/projects/project-agents) qui traitent des tâches et aux nœuds agent des [automatisations](/fr/platform/automations/concepts) de créer des images, par exemple la couverture d’un rapport ou un visuel de campagne. Elle reste désactivée tant que tu ne l’actives pas.

1. Active **Autoriser la génération d'images**. L’interrupteur enregistre aussitôt.
2. Laisse **Modèle d'images** sur **Automatique**, ou choisis un modèle et enregistre les modifications en attente dans l’en-tête de la page.
3. Vérifie la ligne sous la sélection. Elle nomme le modèle qui crée les images.

<Frame caption="Gouvernance > Modèles — la génération d’images activée, avec un modèle d’image fixé.">

![La section Génération d'images avec son interrupteur activé, le sélecteur Modèle d'images réglé sur OpenRouter · google/gemini-2.5-flash-image et la ligne en dessous qui nomme le modèle qui crée actuellement les images.](/images/platform/governance-image-generation.webp)

</Frame>

**Automatique** prend le premier modèle d’une courte liste recommandée que tes identifiants fournisseur atteignent : Gemini 2.5 Flash Image, GPT Image 2.5 Flare, GPT Image 1 Mini jusqu’à son arrêt par OpenAI le 1er décembre 2026, puis FLUX.2 Pro. Tale tient compte pour cela des identifiants OpenRouter et OpenAI. La sélection liste chaque modèle d’images que tes identifiants peuvent servir, y compris ceux d’autres fournisseurs compatibles. Elle écarte les modèles vectoriels, dont Tale ne conserve pas les fichiers SVG. Un modèle de retouche, qui a besoin d’une image de départ dans chaque requête, reste sélectionnable ; **Automatique** n’en choisit jamais, et Tale refuse une requête sans image avant toute facturation. Un modèle choisi reste fixé jusqu’à ce que tu le changes ; s’il devient indisponible, Tale le signale et ne passe pas à un autre modèle. OpenAI a arrêté GPT Image 1 le 23 octobre 2026 et arrête GPT Image 1 Mini le 1er décembre 2026 : si tu as choisi l’un des deux, choisis un autre modèle ou **Automatique**. Désactiver la génération d’images conserve le modèle choisi pour la prochaine activation.

Tant que la génération d’images est activée et qu’un modèle est disponible, chaque agent qui commence à travailler dans un environnement doté du canal MCP de Tale reçoit un outil pour les images. Les agents des autres environnements, et tous les agents quand la génération d’images est désactivée, ne voient pas du tout cet outil ; [Choisir un environnement d’agent](/fr/platform/agents/harnesses) indique quels environnements disposent de ce canal. La désactivation refuse aussi la prochaine demande d’image d’un agent déjà en cours. Un agent range ses images parmi ses fichiers : celles d’une tâche apparaissent dans ses fichiers produits, celles d’une étape d’automatisation dans la sortie de l’étape. Dans le chat, l’assistant reçoit le même outil pour les images, et ses images apparaissent sous la réponse ; voir [Créer des fichiers et utiliser des skills dans le chat](/fr/platform/chat/files-and-skills).

Les images existent en trois formats : carré, paysage en 3:2 et portrait en 2:3. Un agent qui demande un autre format, par exemple une bannière en 16:9, reçoit celui qui a la même orientation. Un modèle qui ne dessine ni 3:2 ni 2:3, comme Recraft, se voit demander à la place le format le plus proche qu’il dessine, par exemple 4:3 ou 3:4. Le modèle d’images fixe la taille exacte en pixels, et l’outil pour les images indique à l’agent la taille de chaque image qu’il a enregistrée.

Un agent peut aussi partir de quatre images existantes au plus, par exemple une photo à retravailler, si le modèle d’images accepte des images. Un modèle qui en accepte moins, comme Gemini 2.5 Flash Image avec trois, ne reçoit aucune requête qui en contient davantage : Tale la refuse avant toute facturation et indique la limite à l’agent.

Chaque image est facturée à ton organisation et compte, comme le reste de l’exécution, pour la personne qui l’a lancée ; dans le chat, pour la personne qui discute, et une réponse crée au plus 16 images. Un tour d’agent crée au plus 16 images, une requête à la fois, et ses images puisent dans la même enveloppe que l’usage du modèle pendant ce tour : le coût de chaque image est retiré de ce que le modèle peut encore dépenser, et une fois l’enveloppe épuisée, Tale refuse l’image suivante. Une limite de budget qui s’applique à cette personne refuse l’image avant l’appel au modèle d’images. Fixe des limites de coût ou de requêtes pour les images dans [Politiques et limites](/fr/platform/admin/governance/policies-and-limits) ; [Comment l’usage est compté](/fr/platform/admin/governance/usage-attribution) explique pour qui chaque image compte. Le fichier de politique et les endpoints d’images personnalisés sont décrits dans la [référence des fournisseurs auto-hébergés](/fr/self-hosted/configuration/providers#configure-image-generation).

## Fournir un agent standard {#standard-agent}

Seuls les éditeurs et les rôles supérieurs peuvent ajouter des agents à un projet. Pour qu’un projet sans agents puisse quand même confier du travail à un agent, Tale y propose l’**agent standard** de l’organisation : toute personne qui peut ouvrir le projet peut lui confier une tâche, membres compris. Il est activé par défaut.

<Frame caption="Gouvernance > Modèles — l’agent standard, activé, avec son environnement d’agent et son modèle choisis automatiquement.">

![La section de l’agent standard : l’interrupteur est activé, l’environnement d’agent et le modèle sont réglés sur automatique, et le champ des instructions est vide et renvoie aux instructions intégrées. La dernière ligne indique que, pour toi, il travaille avec Claude Haiku 4.5 et passe la main à Claude Code quand une tâche demande un espace de travail complet.](/images/platform/governance-standard-agent.webp)

</Frame>

- **Où il apparaît.** Dans un projet sans agents, **Assigné à** propose l’option **Agent standard**, et [Créer une tâche depuis le chat](/fr/platform/chat/basics#create-task-from-chat) l’assigne pour toi. Tale le met en place dans un projet dès que quelqu’un l’y choisit ou y confie la tâche d’un chat. L’onglet **Agents** du projet l’affiche ensuite avec le badge **Standard** ; [L’agent standard](/fr/platform/projects/project-agents#standard-agent) explique son fonctionnement.
- **Avec quoi il fonctionne.** Quand **Environnement d'agent** et **Modèle** sont sur **Automatique**, Tale choisit un modèle recommandé que la personne qui lance la tâche peut utiliser selon tes règles d’[accès aux modèles](#limiter-lacces-aux-modeles). Quand cette personne lance la tâche, l’agent travaille avec le modèle et les mêmes outils que le chat, crée des fichiers dans une sandbox légère, et ne passe la main à Claude Code, ou à l’environnement d’agent auquel un modèle d’abonnement est lié, que si la tâche demande un espace de travail complet ; [Comment se déroule une exécution de l’agent standard](/fr/platform/projects/project-agents#standard-agent-runs) le décrit. Les exécutions qu’une automatisation, une planification ou un autre agent démarre, ainsi que celles dont le modèle ne peut être servi que par un environnement d’agent, s’exécutent dès le départ dans cet environnement. La ligne en bas de la section indique lequel des deux cas s’applique pour toi. Choisis un environnement d’agent pour y exécuter toutes les tâches, ou un modèle pour l’imposer à tout le monde, puis enregistre les modifications en attente dans l’en-tête de la page.
- **Ce qu’il sait.** Ses instructions intégrées lui demandent de faire ce que la tâche demande avec ses fichiers et ses commentaires, de livrer comme résultat de la tâche le document, la présentation, le tableur ou le PDF demandé, d’écrire dans la langue de la tâche et de poser sa question dans un commentaire quand la tâche n’est pas claire. Le texte saisi sous **Instructions** les remplace.
- **Ce qu’il peut utiliser.** Les skills de documents `docx`, `pptx`, `xlsx` et `pdf` accessibles au projet, mais aucun des connectors, outils de la plateforme ou secrets qu’un éditeur peut accorder à d’autres agents. Quand une personne le lance, il dispose aussi de ce qu’offre un chat : la recherche dans les connaissances, la lecture de pages web, les fichiers et, si la [génération d’images](#let-agents-generate-images) est activée, les images.

Chaque exécution démarre avec les réglages en vigueur à ce moment-là ; un agent en cours garde ceux avec lesquels il a démarré. Un modèle choisi reste en vigueur même s’il devient indisponible, tout comme un modèle que l’accès aux modèles d’une personne lui refuse : l’agent standard ne démarre alors pas pour elle et indique pourquoi, et Tale ne passe pas à un autre modèle. Choisis un autre modèle ou **Automatique** et enregistre. Si aucun modèle qu’une personne peut utiliser ne peut le faire fonctionner, il ne démarre pas non plus pour elle : ajoute un accès dans [Fournisseurs IA](/fr/platform/admin/providers), ou vérifie son accès aux modèles.

Désactive **Fournir un agent standard** pour ne plus le proposer ; la modification s’enregistre aussitôt et conserve tes choix. Les projets sans agents ne proposent alors aucun agent, et les tâches déjà confiées à un agent standard ne peuvent démarrer qu’une fois que tu le réactives. Le fichier de politique est décrit dans la [référence des fournisseurs auto-hébergés](/fr/self-hosted/configuration/providers#configure-the-standard-agent).

## Choisir le modèle de transcription audio

**Modèle de transcription audio** contrôle la transcription serveur des pièces jointes audio et vidéo, le recours à l’audio pour les liens vidéo sans sous-titres utilisables et la dictée dans les navigateurs sans reconnaissance vocale intégrée. La reconnaissance vocale du navigateur utilise son propre service et garde la priorité lorsqu’elle est prise en charge.

<Frame caption="La transcription audio a sa propre sélection à l’échelle de l’organisation, automatique ou fixée sur un modèle.">

![La section de transcription audio affiche la sélection automatique et indique le modèle actuellement utilisé par le serveur.](/images/platform/governance-content-models.webp)

</Frame>

Si ton accès OpenRouter par défaut est actif, ses modèles de reconnaissance vocale sont aussi disponibles ici. Tale les découvre dans le catalogue OpenRouter. Vérifie que les modèles autorisés pour cet accès incluent le modèle de transcription souhaité, puis utilise **Automatique** ou sélectionne ce modèle explicitement.

1. Dans **Modèle qui transcrit l'audio**, laisse **Automatique** pour que Tale choisisse un modèle compatible disponible, ou sélectionne un fournisseur et un modèle précis.
2. Enregistre les changements en attente dans l’en-tête. Avant l’enregistrement, la sélection reste un brouillon ; abandonne-le pour conserver le réglage enregistré.
3. Vérifie le modèle actuel affiché sous la sélection. Teste un court enregistrement avant de compter sur cette configuration pour importer un fichier plus long.

Un changement de modèle s’applique aux nouvelles transcriptions ; les pièces jointes déjà traitées conservent leur texte. Importer à nouveau les mêmes octets réutilise le travail terminé pour la même cible de transcription, mais relance la transcription si le fournisseur ou le modèle cible diffère.

Une sélection explicite reste fixe. Si ce modèle devient indisponible, Tale le signale et ne passe pas à un autre modèle. Choisis un autre modèle disponible ou **Automatique**, puis enregistre. Si aucun modèle compatible n’est disponible, configure un accès actif dans [Fournisseurs IA](/fr/platform/admin/providers) et vérifie les modèles autorisés pour cet accès. Si Tale ne peut momentanément pas vérifier la configuration, réessaie plutôt que de changer de modèle pour cette raison.

Si la transcription serveur indisponible empêche un membre de dicter ou de joindre de l’audio ou de la vidéo, une boîte de dialogue explique le problème et peut être fermée. Selon ses droits, un lien mène aux réglages ou un message lui demande de contacter un admin. Une vérification de disponibilité ayant échoué temporairement peut être relancée. Pour gérer ce choix par la configuration du déploiement ou utiliser un endpoint audio personnalisé, consulte la [référence des fournisseurs auto-hébergés](/fr/self-hosted/configuration/providers#configurer-la-transcription-audio).

## Expliquer un choix inattendu

Vérifie les rôles et équipes du membre, le choix explicite dans le chat, le modèle par défaut correspondant, la règle d’accès et la liste de modèles des identifiants fournisseur. Une entrée au catalogue ne prouve pas que l’organisation dispose d’identifiants utilisables. Les plafonds de coût et de tokens continuent de s’appliquer via [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).
