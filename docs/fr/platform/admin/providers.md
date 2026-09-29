---
title: Fournisseurs IA
description: Connecte les identifiants des fournisseurs, rends les modèles disponibles et résous les choix manquants.
---

Connecte un fournisseur IA avant de lancer des chats ou des agents dans Tale. Dans **Paramètres > Fournisseurs IA**, les propriétaires, admins et développeurs gèrent les identifiants de l’organisation. Le fournisseur définit la connexion et les méthodes d’authentification ; les identifiants donnent à ton organisation accès à ce fournisseur.

<Frame caption="Chaque ligne correspond à des identifiants. Le badge Par défaut indique ceux utilisés lorsqu’un appel n’en désigne pas.">

![La page des fournisseurs IA présente des identifiants avec leur fournisseur, leur méthode d’authentification et le badge Par défaut.](/images/get-started/settings-providers.webp)

</Frame>

## Ajouter les premiers identifiants

1. Sélectionne **Ajouter des identifiants**, puis le fournisseur. Les fournisseurs déjà configurés apparaissent en premier ; les choisir à nouveau permet d’ajouter d’autres identifiants.
2. Choisis une **Méthode d'authentification** si le fournisseur en propose plusieurs.
3. Vérifie le champ **Nom**. Il est prérempli avec le nom du fournisseur, suivi d’un numéro si d’autres identifiants de ce fournisseur portent déjà ce nom : `OpenRouter`, puis `OpenRouter 2`. Un nom qui indique l’usage, comme `Clé de production` ou `Équipe finance`, permet de distinguer plusieurs identifiants d’un même fournisseur. Renseigne ensuite les champs requis par la méthode.
4. Vérifie la liste **Modèles autorisés**. Pour un fournisseur avec catalogue, une liste vide autorise les modèles du catalogue. Sans catalogue, tu dois préciser les identifiants des modèles.
5. Sélectionne **Ajouter**. Vérifie la ligne créée et définis-la par défaut pour ce fournisseur si les requêtes habituelles doivent l’utiliser.

Pour des identifiants de type **Clé API** ou **Variable d'environnement**, envoie un court message de test dans un chat avec le modèle prévu. Le modèle doit être disponible via des identifiants actifs et autorisé par les règles de l’organisation. Vérifie les identifiants d’abonnement avec un agent de tâche ou d’automatisation, comme indiqué ci-dessous. Enregistrer des identifiants ne prouve pas que le fournisseur acceptera les requêtes.

## Choisir la méthode d’authentification

| Méthode | Informations à fournir | Usage |
| --- | --- | --- |
| **Clé API** | La clé secrète du fournisseur | Accès API facturé à l’usage. Le secret enregistré est chiffré et seul un fragment masqué reste visible. |
| **Variable d'environnement** | Le nom d’une variable du déploiement | L’opérateur gère le secret hors de l’interface. Son nom doit commencer par `TALE_PROVIDER_KEY_`. |
| **Clé d'abonnement** | Un secret d’abonnement pris en charge | Exécution dans l’environnement d’agent du fournisseur, plutôt que par un appel API direct. |
| **Courtier d'abonnement** | L’adresse du courtier et la configuration de sa réponse | Le déploiement obtient des tokens d’abonnement utilisables auprès du courtier. |

Seules les méthodes du fournisseur sélectionné apparaissent. Référencer une variable ne la crée pas : demande à l’opérateur de la fournir selon le [guide de configuration des fournisseurs](/fr/self-hosted/configuration/providers).

## Connecter un courtier d’abonnement

Les courtiers d’abonnement prennent en charge les abonnements Anthropic via Claude Code et les abonnements OpenAI ChatGPT via Codex. Ces identifiants servent aux agents de tâche et d’automatisation ; les chats nécessitent des identifiants d’accès direct à l’API.

| Fournisseur et agent | Variable cible |
| --- | --- |
| Anthropic · Claude Code | `CLAUDE_CODE_OAUTH_TOKEN` |
| OpenAI · Codex | `TALE_SUBSCRIPTION_TOKEN` |

À l’ajout des identifiants, choisis **Courtier d'abonnement** et demande à ton opérateur l’adresse du courtier et les paramètres d’authentification. Utilise une adresse qui ne fournit que les jetons du fournisseur choisi. Avec Tale AI Gateway, il s’agit de `/api/tokens/anthropic` ou de `/api/tokens/openai`.

Renseigne `$.tokens` dans **Chemin du tableau de jetons**, `access_token` dans **Champ du jeton** et la valeur du tableau ci-dessus dans **Variable d'environnement cible**. Sous **Avancé**, utilise `status` pour **Champ de statut**, `active` pour **Valeur de statut actif** et `expires_at` pour **Champ d'expiration**, et laisse **Marge de sécurité avant expiration (ms)** à sa valeur par défaut. Tale AI Gateway retient lui-même un compte dont le jeton va bientôt être actualisé tant qu’un autre compte peut prendre le travail ; Tale l’utilise quand même si aucun autre compte disponible ne peut prendre l’exécution, par exemple pendant que les autres sont en pause après avoir atteint une limite de requêtes. Les chemins peuvent différer avec un autre courtier. Un pool OpenAI doit aussi fournir l’`account_id` du fournisseur pour chaque jeton utilisable ; l’`id` propre au courtier est un identifiant de compte distinct.

Pour OpenAI, limite **Modèles autorisés** aux identifiants de modèles pris en charge par ton abonnement ChatGPT. Le catalogue de l’API OpenAI peut inclure des modèles auxquels cet abonnement ne donne pas accès.

Choisis **Sélection du jeton** selon la répartition souhaitée pour les nouveaux tours d’agent :

- **Aléatoire**, le choix initial, donne à chaque compte utilisable la même probabilité à chaque sélection.
- **Premier utilisable** prend toujours le premier compte utilisable dans l’ordre du courtier. Ce choix établit un ordre de préférence, sans répartir le travail.
- **Round-robin** choisit le compte utilisable dont la dernière sélection est la plus ancienne. Tous les processus backend partagent cet historique pour l’organisation et les identifiants concernés, y compris lors de requêtes simultanées. L’ordre des réponses et les redémarrages du backend conservent cet historique ; des identifiants de compte stables chez le courtier le préservent aussi lors des changements de jetons. Cela répartit les sélections, sans garantir une consommation de jetons ou un nombre d’agents en cours identiques.

Enregistre les identifiants, puis lance une courte tâche ou automatisation avec le fournisseur et l’environnement d’agent correspondants. Vérifie que l’agent termine sa réponse. Si aucun compte n’est utilisable, demande à l’opérateur de vérifier l’autorisation des comptes, l’expiration et les actualisations prévues des jetons, ainsi que les quotas signalés. La [référence de configuration du courtier](/fr/self-hosted/configuration/providers#connecter-un-courtier-dabonnement) décrit les métadonnées facultatives, les valeurs par défaut et les solutions aux erreurs.

## Configurer Azure ou une adresse propre au compte

Azure OpenAI demande une **URL de l'endpoint**, généralement `https://<resource>.openai.azure.com/openai/v1`. Les identifiants appartiennent à cette ressource. Les identifiants de modèle Azure sont les noms de déploiement définis dans la ressource : saisis-les dans la liste **Modèles autorisés**. Sans catalogue, laisser cette liste vide ne rend aucun modèle disponible.

Utilise les adresses et identifiants documentés par le fournisseur. Le nom affiché sur une page commerciale n’est pas forcément celui que son API accepte.

## Définir un fournisseur personnalisé

Une organisation peut connecter un endpoint absent du catalogue livré : un serveur de modèles auto-hébergé comme vLLM ou Ollama, ou une passerelle interne qui parle l’API OpenAI ou Anthropic. Choisis **Ajouter des identifiants**, puis **Fournisseur personnalisé**, l’entrée fixée sous le catalogue :

1. Saisis un **Nom du fournisseur**. Il nomme le fournisseur et cet identifiant ; le nom technique du fournisseur en est dérivé.
2. Choisis le **Format d'API** que parle l’endpoint et saisis son **URL de base**, la racine d’API à laquelle la plateforme ajoute ses chemins. Un hôte public exige `https`.
3. Sous **Modèles**, garde **Découvrir depuis l'endpoint** pour lire la liste `/models` du serveur avec cette clé, ou choisis **Saisir les ID de modèles** et indique les ID exacts dans **Modèles autorisés** si l’endpoint ne sait pas lister ses modèles.
4. Renseigne la **Clé API** (ou la variable d’environnement), puis choisis **Ajouter**.

La ligne de l’identifiant affiche désormais le fournisseur avec le badge **Personnalisé**, et le fournisseur apparaît avec le même badge dans le catalogue d’**Ajouter des identifiants** ; le choisir là ajoute un autre identifiant pour lui. Une adresse privée ou de boucle locale exige en plus l’autorisation des hôtes privés dans le déploiement ; c’est l’opérateur qui la définit, et enregistrer l’identifiant ne l’accorde pas. Demande à l’opérateur de préparer l’accès réseau et la politique du déploiement, puis suis [Connecter un serveur de modèles local](/fr/tutorials/admin/connect-local-provider). Si des agents de programmation utiliseront le fournisseur, teste aussi une session d’agent : leur trafic passe par une passerelle distincte qui doit aussi disposer de l’accès réseau et faire confiance au certificat.

Dans le menu de la ligne, **Vérifier les modèles** relit la liste de modèles de l’endpoint avec cette clé, **Modifier les identifiants** change, à côté du nom, l’URL de base, le format d’API et la source des modèles, et **Supprimer** retire l’identifiant. Supprimer le dernier identifiant d’un fournisseur retire aussi le fournisseur lui-même ; la boîte de dialogue le dit avant. Chaque version enregistrée de la définition reste dans l’historique de configuration de l’organisation. Ce que le formulaire ne couvre pas, comme un endpoint pour les agents de programmation, se règle dans le fichier de définition que décrit le [guide de configuration des fournisseurs](/fr/self-hosted/configuration/providers).

## Définir le choix par défaut et l’accès aux modèles

Sélectionne **Définir par défaut** dans le menu d’une ligne. Chaque fournisseur a un seul choix par défaut ; en sélectionner un autre déplace le badge. Des identifiants désactivés ne peuvent pas devenir le choix par défaut. En son absence, l’appelant doit nommer les identifiants à utiliser.

La liste **Modèles autorisés** limite seulement les identifiants concernés. [Modèles](/fr/platform/admin/governance/content-models) définit les modèles par défaut et les règles d’accès des personnes, équipes et rôles pour tous les fournisseurs. Les deux restrictions s’appliquent : élargir une liste ne contourne pas l’autre.

La section **Harnesses**, sous le tableau, est en lecture seule. Elle présente les modèles et abonnements disponibles pour chaque environnement d’exécution. Modifie les identifiants au-dessus pour changer cette configuration.

## Résoudre un modèle absent ou en échec

- S’il manque un choix par défaut, sélectionne les identifiants actifs prévus et définis-les par défaut.
- Si le catalogue n’a pas pu être chargé, utilise **Actualiser les catalogues** et examine le résultat du fournisseur. Les catalogues distants sont mis en cache ; les catalogues intégrés évoluent avec la plateforme.
- Si un modèle manque, vérifie la liste des modèles autorisés et les règles de l’organisation. Sans catalogue, vérifie les identifiants exacts des modèles.
- Si une requête est refusée, vérifie l’activation des identifiants, les droits du compte fournisseur, l’adresse et le quota fournisseur avant de modifier les règles des modèles.

## Renouveler ou retirer des identifiants

Utilise l’action de remplacement de la ligne pour changer le secret en conservant le nom et les références. **Désactiver** suspend les identifiants sans retirer leur configuration ; **Activer** les remet en service. Vérifie le remplacement avec le modèle prévu.

<Warning>

Supprimer des identifiants retire l’accès aux appelants qui en dépendent. Migre-les d’abord. Si tu supprimes le choix par défaut, désigne son remplacement pour que les appels sans sélection explicite puissent encore fonctionner. Les identifiants que le modèle d’embedding de la recherche de connaissances utilise — ceux choisis sous **Paramètres > Résidence des données > Modèle d’embedding**, ou le dernier identifiant par défaut actif de ce fournisseur — ne peuvent pas être supprimés : la boîte de dialogue nomme la dépendance et Tale refuse la suppression. Choisis d’abord d’autres identifiants pour le modèle d’embedding.

</Warning>
