---
title: Connectors
description: Comment un connecteur est déclaré, ce qu’une de ses actions promet à l’appelant, et où va ton propre code quand aucun connecteur ne convient.
---

Un connecteur donne à Tale un moyen réutilisable d'appeler un service. Sa définition décrit l'authentification, les destinations autorisées et les actions ; chaque organisation fournit ses propres identifiants. Cette page t'aide à examiner ce contrat ou à contribuer un nouveau connecteur.

Pour connecter un compte dans l'application, consulte [Identifiants des connecteurs](/fr/platform/admin/connectors). Pour choisir une intégration existante, parcours le [catalogue](/fr/platform/connectors/overview).

## Comment un connecteur est déclaré

Les définitions se trouvent dans `configs/platform/system/connectors/<slug>/connector.yml`, avec l'icône du connecteur. Le slug du dossier doit correspondre à `name`. Une automatisation appelle une action avec `<connector>.<action>`, par exemple `tavily.search`. Les connecteurs de fournisseurs apparaissent dans les paramètres ; les connecteurs internes utilisant l'authentification de la plateforme n'y figurent pas.

Cet extrait de la définition Tavily fournie montre l'identité et l'authentification. Ce n'est pas un connecteur complet : les définitions d'actions doivent aussi figurer dans le fichier.

```yaml
name: tavily
displayName: Tavily
description: Real-time web search and page extraction for AI research.
tags:
  - Search
allowedHosts:
  - api.tavily.com
auth:
  - method: api-key
```

### Définir les destinations autorisées

| Champ | Signification |
| --- | --- |
| `endpointMode: fixed` | Valeur par défaut. Les appels HTTP réels utilisent des URL fixes ; `allowedHosts` contient les hôtes exacts |
| `endpointMode: per-credential` | Chaque identifiant fournit une `endpointUrl` HTTPS ; les actions lisent son origine sans barre oblique finale via `ctx.endpoint` |
| `allowedHosts` en mode per-credential | Suffixes d'hôtes : `atlassian.net` autorise ses sous-domaines |
| `configFields` | Valeurs non secrètes propres à l'identifiant : hôte, port, région ou version d'API |

Confluence et Shopify utilisent des origines propres à chaque identifiant. Les secrets n'ont pas leur place dans `configFields` : conserve-les dans les données d'identification chiffrées. Pour les actions JavaScript, `ctx.http` applique la restriction des destinations HTTP. Les backends natifs, comme les protocoles de messagerie, appliquent leurs propres contrôles ; une liste HTTP ne décrit pas toute leur sécurité réseau.

<Info>

Ajouter un connecteur demande une contribution au code source. L'exécution lit le catalogue de la plateforme ; une organisation ne peut pas importer sa propre définition. Commence par [l'environnement de contribution](/fr/develop/contributor-setup), puis étudie un connecteur existant utilisant une authentification et un transport similaires.

</Info>

## Ce qu’une action déclare

| Champ | Contrat pour l'auteur et l'appelant |
| --- | --- |
| `name`, `description` | Nom stable en snake_case et explication de l'usage de l'action |
| `input` | Schéma JSON objet, validé avant exécution ; décrire les champs et signaler ceux requis |
| `output` | Signature du résultat au style TypeScript ; documentation, pas validation des sorties à l'exécution |
| `effects` | `read` ou `write` ; les écritures passent par la politique d'approbation |
| `mock` | JavaScript déterministe obligatoire : même entrée, même sortie, sans accès réseau |
| `backend` | Implémentation réelle facultative : `yaml-js` avec `live`, ou `native` avec un identifiant `impl` |
| `exampleInput` | Petit exemple facultatif utile à la découverte et aux tests |

Sans backend réel, le connecteur fonctionne en simulation mais refuse l'exécution réelle. Une écriture n'a pas lieu si la plateforme ne peut pas obtenir une décision d'approbation. La [référence de politique](/fr/self-hosted/configuration/approvals) explique la priorité des règles et les décisions en attente.

Pour comprendre un résultat, lis aussi l'implémentation réelle. Par exemple, la recherche Tavily décrit l'entrée `max_results`, mais l'action fournie limite les résultats renvoyés à cinq. La signature de sortie seule ne précise pas cette limite.

### Sélectionner le bon compte

L'identifiant est choisi au moment de l'appel : celui nommé explicitement, sinon celui par défaut du connecteur. Modifier le défaut peut donc changer le compte d'une exécution ultérieure. Nomme l'identifiant explicitement lorsque le compte fait partie du contrat de ton intégration.

La découverte des boîtes mail fait exception : `conversation.sync_mailbox` et `conversation.list_mailbox_messages` parcourent tous les identifiants actifs du connecteur. Ces actions couvrent ainsi toutes les boîtes connectées, sans se limiter au compte par défaut.

## Les méthodes d’authentification

Un connecteur peut accepter plusieurs méthodes ; un identifiant enregistré en utilise exactement une.

| Méthode   | Libellé dans l’interface          | Ce que porte l’identifiant                                                                                                     |
| --------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `api-key` | Clé API                           | Un secret unique que le corps de l’action place lui-même — un en-tête du fournisseur, un paramètre d’URL ou un champ du corps. |
| `bearer`  | Jeton                             | Un jeton envoyé dans l’en-tête Authorization, sous le schéma que le connecteur nomme.                                          |
| `basic`   | Nom d’utilisateur et mot de passe | Un nom d’utilisateur et un mot de passe en HTTP Basic, la forme que prend aussi un login de boîte mail.                        |
| `oauth2`  | OAuth                             | Une autorisation par code : jeton d’accès, jeton de rafraîchissement, expiration et portées accordées.                         |

La méthode interne `platform` n'a pas d'identifiant enregistré et ne peut pas être combinée avec les méthodes de fournisseurs. Elle est réservée aux capacités natives de Tale, comme les actions sur les tâches ou les documents.

Les secrets sont chiffrés au repos. Les listes renvoient un aperçu masqué et des métadonnées, pas le secret en clair ; l'exécution autorisée résout le secret au moment de l'action. Un enregistrement réussi confirme le stockage, pas la validité chez le fournisseur ni les permissions nécessaires.

## Enregistrer une application OAuth

Le connecteur déclare les URL d'autorisation et de jeton, ainsi que les permissions demandées. Configure d'abord l'application du fournisseur, puis connecte un compte par son intermédiaire.

| Source | Priorité et configuration |
| --- | --- |
| Application d'organisation | Prioritaire. Un administrateur renseigne ID client et secret dans **Paramètres > Connecteurs > Applications OAuth** |
| Application de déploiement | Défaut sans application d'organisation : `CONNECTOR_OAUTH_<SLUG>_CLIENT_ID` et `CONNECTOR_OAUTH_<SLUG>_CLIENT_SECRET` |

Dans les variables d'environnement, mets le slug en majuscules et remplace ses tirets par des traits de soulignement. Pour une application Microsoft à locataire unique, configure aussi l'ID d'annuaire afin de cibler ce locataire plutôt que `/common`. Les secrets d'organisation sont chiffrés et ne sont plus affichés ensuite.

### Enregistrer exactement l'URL de retour

Tous les connecteurs OAuth d'organisation utilisent cette URI de redirection :

```text
${SITE_URL}${BASE_PATH}/api/connectors/oauth2/callback
```

Le schéma, l'hôte et le chemin doivent correspondre exactement, sans barre oblique finale. Tale refuse de commencer le consentement si `SITE_URL` manque ; il ne déduit pas une URL publique de la requête reçue. Un refus `redirect_uri` sur l'écran du fournisseur indique généralement une différence entre l'URI enregistrée et celle envoyée.

Les imports personnels OneDrive/Google Drive pour les connaissances suivent un parcours distinct. Google Drive partage son application OAuth entre connecteur et import : enregistre les deux URI de redirection sur ce client Google. Le retour d'import est décrit dans la [référence d'environnement](/fr/self-hosted/configuration/environment-reference).

### Configurer le point d'accès aux événements Slack

L'application Slack se configure uniquement au niveau du déploiement : `CONNECTOR_OAUTH_SLACK_*` et `CONNECTOR_SLACK_SIGNING_SECRET`. L'événement entrant doit être vérifié avant que Tale connaisse l'organisation ; une application d'organisation ne peut donc pas fournir ce secret.

Enregistre `${SITE_URL}${BASE_PATH}/api/connectors/slack/events` comme Events Request URL. Sans secret de signature, même la validation initiale renvoie `503`. Avec une configuration valide, Tale vérifie les signatures et identifie l'organisation à partir de l'espace Slack. Le point d'accès accuse actuellement réception des événements ; il ne transforme pas les messages Slack entrants en conversations et ne lance pas automatiquement d'automatisation.

## Choisir une surface

| Besoin | Solution |
| --- | --- |
| Action fournisseur prise en charge | Connecteur fourni et identifiant d'organisation |
| Action réutilisable absente du catalogue | Contribution avec schéma, mock déterministe, backend réel et tests |
| Appels propres au projet vers ton service | Secrets et code dans la sandbox d'un agent de projet, selon ses permissions réseau |
| Logique personnalisée dans une automatisation | Nœud `transform`, selon les capacités et règles réseau du moteur |

Un secret permet l'authentification ; il ne rend pas joignable un service privé inaccessible. Vérifie le réseau depuis la sandbox ou le moteur réellement utilisé avant de concevoir ton intégration autour de cet accès.

L'enregistrement de serveurs MCP externes n'est pas disponible. Le [point d'accès MCP de Tale](/fr/develop/mcp-endpoint) permet à un client externe d'appeler Tale ; il n'ajoute pas de connecteur sortant vers un autre serveur MCP.

## Où cela s’inscrit

Pour une contribution, teste séparément la validation du schéma, le comportement déterministe du mock et les appels réels au fournisseur. Vérifie aussi les échecs : identifiant absent, permission insuffisante, destination refusée, entrée invalide, refus fournisseur et approbation en attente pour une écriture. Le [guide de contribution](/fr/develop/contributor-setup) décrit l'environnement local ; le [guide des identifiants](/fr/platform/admin/connectors) décrit la configuration par l'administrateur.
