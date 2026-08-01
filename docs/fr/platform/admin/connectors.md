---
title: Identifiants d’connector
description: Sous Paramètres > Connectors, une organisation ajoute, nomme, promeut, désactive et reconnecte les identifiants avec lesquels chaque connecteur livré s’authentifie.
---

Chaque connecteur est livré avec la plateforme, le travail d’administration ne consiste donc jamais à installer : il consiste à décider au nom de quels comptes Tale peut agir, puis à garder ces identifiants en bonne santé. Un connecteur porte autant de lignes que nécessaire — une par espace de travail, boutique, boîte mail ou bot — et l’une d’elles répond pour tout appelant qui n’en nomme aucune. Cette page est le versant exploitation : ce que la page affiche, comment se remplit chaque méthode d’authentification, et ce qui arrive quand tu promeus, désactives, supprimes ou reconnectes une ligne.

Le catalogue lui-même — les treize connecteurs, ce que chacun apporte, et comment leurs actions rejoignent les automatisations et le chat — est sur [Connectors](/fr/platform/connectors/overview). Le temps de lecture ici est mieux investi dans le cycle de vie des identifiants, parce que c’est la partie qui varie d’une organisation à l’autre et la partie qui casse.

## Ce que la page affiche

Ouvre **Paramètres > Connectors**. La page demande des droits Admin ou Développeur et c’est un tableau des identifiants que ton organisation détient — une ligne par identifiant, pas une par connecteur livré. Une ligne montre son nom, le connecteur qu’il authentifie, sa méthode d’authentification et ses coordonnées : un aperçu masqué du secret stocké, plus l’URL d’instance là où le connecteur en réclame une. Un badge **Par défaut** marque celui vers lequel une action retombe, un badge **Désactivé** ceux qui sont coupés.

La recherche couvre à la fois le nom que tu as donné et le connecteur derrière ; le bouton de filtre réduit à un seul connecteur. Un lien `?connector=` réduit le tableau de la même façon, et c’est là que le détour OAuth te ramène.

Deux avertissements apparaissent ici, et ils ne disent pas la même chose. _Aucun identifiant par défaut pour {connector}_ signifie que chaque ligne fonctionne mais que rien ne répond à un appelant qui n’en nomme aucune. **Reconnexion requise** sur une ligne signifie qu’une autorisation OAuth ne se renouvelle plus et redemande un consentement — l’identifiant lui-même est sain.

## Ajouter des identifiants

**Ajouter des identifiants** ouvre le catalogue livré. Les connecteurs pour lesquels tu détiens déjà un identifiant viennent en premier, sous **Utilisés** ; tout le reste suit sous **Disponibles**, par ordre alphabétique, chacun avec ses catégories et le nombre d’actions qu’il expose. La recherche réduit la liste ; un choix mène à l’étape de configuration, et **Retour au catalogue** en ressort.

La configuration demande d’abord un **Nom**, et le texte d’aide du champ dit pourquoi il compte : le nom sous lequel une action choisit ces identifiants. Prends quelque chose qu’un auteur d’automatisations reconnaîtra des mois plus tard, comme `Boîte de support` ou `Boutique UE`.

Ce qui suit le nom dépend de la **Méthode d’authentification** que le connecteur accepte.

<Tabs>

<Tab title="Clé API">

Un seul champ, **Clé API**. Ce sont les actions du connecteur qui décident par où la clé voyage — un en-tête imposé par le fournisseur, ou le corps de la requête là où le fournisseur l’exige. Shopify et Tavily sont les cas livrés.

</Tab>

<Tab title="Jeton">

Un seul champ, **Jeton**, envoyé dans l’en-tête Authorization à chaque requête. GitHub prend ainsi un jeton d’accès personnel ; Discord prend un jeton de bot, que la plateforme envoie sous le schéma propre à Discord plutôt que sous le schéma habituel.

</Tab>

<Tab title="Nom d’utilisateur et mot de passe">

Deux champs, **Nom d’utilisateur** et **Mot de passe**, envoyés en HTTP Basic. Le couple n’est pas toujours un login au sens courant : Confluence prend l’e-mail du compte avec un jeton d’API, Twilio prend l’Account SID avec l’Auth Token, et le connecteur WebDAV prend un mot de passe d’application WebDAV. IMAP / SMTP prend le login de la boîte elle-même.

</Tab>

<Tab title="OAuth">

Aucun secret à saisir, donc l’étape de configuration se réduit au passage de relais : **Connecter** te mène à l’écran de consentement du fournisseur, et Tale range ce qui revient — jeton d’accès, jeton de rafraîchissement, expiration et portées accordées — dans une nouvelle ligne. Gmail, Google Drive, Outlook, Teams et Slack se connectent ainsi. Un connecteur qui accepte les deux propose les deux, avec **Connecter** en premier.

</Tab>

</Tabs>

Ajouter un second identifiant à un connecteur qui en a déjà un, c’est le même parcours une seconde fois — le connecteur apparaît simplement sous **Utilisés** dans le catalogue. Il n’y a aucune limite à contourner ni rien à déconnecter avant.

<Note>

Confluence et Shopify demandent en plus une **URL de l’instance**, faute d’hôte unique côté fournisseur. Confluence veut l’adresse de ton site Atlassian — celle où tu ouvres Confluence. Shopify veut l’adresse `myshopify.com` de ta boutique, c’est-à-dire l’adresse d’administration et non le domaine de la vitrine. Cette valeur est stockée en clair à dessein, pour que le tableau puisse montrer sur quelle instance pointe chaque ligne.

</Note>

## Choisir l’identifiant par défaut

Un identifiant par connecteur peut être celui **Par défaut**, et **Définir par défaut** le déplace sur n’importe quelle ligne. C’est lui qui répond quand un nœud d’automatisation ou une action de chat ne nomme aucun identifiant — soit la majorité des cas. Nommer un identifiant explicitement reste l’exception, réservée au workflow qui doit passer par un compte précis.

Un connecteur avec plusieurs identifiants et aucun par défaut est une configuration qui marche, avec un trou dedans. Les appelants qui nomment une ligne continuent de tourner ; les autres ne peuvent pas choisir et échouent. Promeus une ligne et le trou se referme aussitôt.

## Remplacer un secret

Changer une clé est une modification de l’identifiant, pas une opération à part. Ouvre la ligne et choisis **Remplacer la clé API**, **Remplacer le jeton** ou **Remplacer le nom d’utilisateur et le mot de passe**, selon la méthode. Le secret stocké n’est jamais réaffiché, et en saisir un nouveau le remplace partout où cet identifiant est utilisé — chaque nœud d’automatisation et chaque action de chat qui pointe dessus reprend le nouveau secret sans qu’on y touche.

L’identifiant garde son nom, son drapeau par défaut et son URL d’instance à travers un remplacement, rien n’a donc besoin d’être repointé en aval. **Modifier le nom et l’instance** couvre l’autre sens : renommer une ligne, ou la déplacer vers une autre instance.

## Désactiver et supprimer

**Désactiver** retire un identifiant du service tout en gardant la ligne et tout ce qui y est configuré. L’identifiant apparaît comme **Désactivé** et plus rien ne se résout vers lui ; **Activer** le remet en jeu. Sers-t’en quand un compte est suspect plutôt que terminé, ou quand tu veux mettre une configuration de côté sans la perdre.

<Warning>

**Supprimer** agit tout de suite et sans retour. Les automatisations et actions de chat qui utilisent cet identifiant perdent l’accès à ce connecteur sur-le-champ — il n’y a pas de délai de grâce. Supprimer celui par défaut laisse le connecteur sans défaut jusqu’à ce qu’une autre ligne soit promue, et la confirmation le dit avant que tu valides.

</Warning>

## Reconnecter une autorisation cassée

Un identifiant OAuth dont l’autorisation stockée a expiré ou a été révoquée affiche **Reconnexion requise** avec le motif. C’est un constat de la plateforme, pas une décision d’exploitant, et c’est pourquoi cela se lit autrement qu’un identifiant désactivé à la main : rien ne cloche dans la ligne, le fournisseur a seulement cessé d’honorer l’autorisation.

**Reconnecter** relance le consentement du fournisseur et rétablit l’accès sur la même ligne, en gardant son nom, son drapeau par défaut et toutes les références qui pointent dessus. Un identifiant que tu as désactivé toi-même ne se répare pas ainsi : là, c’est **Activer** qui règle la question, et reconnecter répondrait à la mauvaise.

## Connectors et serveurs MCP

Les deux surfaces laissent un agent aller au-delà de Tale, et la différence tient à qui possède le pont. Un connecteur est propre à un fournisseur, arrive avec la plateforme et est maintenu pour toi ; ta part, ce sont les identifiants. Un serveur MCP est un processus que tu héberges et enregistres sous **Paramètres > API > MCP**, exposant les outils que tu écris. Prends le connecteur quand il en existe un pour le système visé, et les [serveurs MCP](/fr/platform/connectors/mcp-servers) quand il n’y en a pas.

## Où cela s’inscrit

Gérer les identifiants, c’est désormais toute l’administration des connectors, puisque plus rien ne s’installe : ajouter les comptes, les nommer correctement, garder un identifiant par défaut par connecteur, et reconnecter les lignes OAuth qui expirent. [Connectors](/fr/platform/connectors/overview) est le catalogue auquel ces identifiants s’attachent, [Outils d’agent](/fr/platform/agents/tools) montre comment les actions qui en découlent arrivent dans la trousse d’un agent, et [Configurer les approbations](/fr/platform/approvals/configure) est l’endroit où les actions en écriture attendent qu’une personne les libère.
</content>
</invoke>
