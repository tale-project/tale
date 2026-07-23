---
title: Fournisseurs IA
description: Relie ton organisation aux modèles qu’elle a le droit d’appeler — les connecteurs de fournisseurs livrés avec la plateforme, les identifiants que tu enregistres en face, et les défauts, listes autorisées et catalogues qui décident de ce que chacun pourra choisir.
---

Tale ne répond à aucun prompt tant que ton organisation ne détient pas d’identifiants valides pour au moins un fournisseur IA. **Paramètres > Fournisseurs IA** est l’endroit où vivent ces identifiants, et le seul où on peut en créer. Les Administrateurs et les Développeurs ouvrent la page ; tous les autres en rencontrent le résultat plus tard, sous la forme de la liste de modèles qu’ils peuvent choisir dans le chat, sur un agent ou sur une étape de workflow.

## Connecteurs et identifiants

Deux choses distinctes se rejoignent sur cette page, et les distinguer rend tout le reste évident.

Un **connecteur** est ce que la plateforme sait d’avance d’un fournisseur : le dialecte réseau qu’il parle, l’endpoint sur lequel il répond, d’où vient sa liste de modèles, et quelles méthodes d’authentification il accepte. Les connecteurs sont livrés avec la plateforme. Tu ne peux ni en ajouter, ni en modifier, ni en supprimer depuis l’interface, et une mise à niveau peut en apporter d’autres.

Les **identifiants** sont ta moitié — la part qui autorise réellement un appel. Tu en enregistres autant que nécessaire par connecteur : une clé de production à côté d’une clé de test, une clé par service, une variable gérée par les ops à côté d’une clé que tu fais tourner à la main. Chacun porte un nom, une méthode d’authentification, une liste de modèles autorisés facultative et un état d’activation — et l’un d’eux est le défaut.

Voici les connecteurs livrés aujourd’hui :

| Connecteur           | Format réseau          | Catalogue de modèles           |
| -------------------- | ---------------------- | ------------------------------ |
| OpenRouter           | API compatible OpenAI  | Catalogue OpenRouter           |
| OpenAI               | API compatible OpenAI  | Catalogue intégré              |
| Anthropic            | API Anthropic Messages | Catalogue intégré              |
| Gemini               | API compatible OpenAI  | Catalogue intégré              |
| Azure OpenAI         | API compatible OpenAI  | Pas de catalogue               |
| DeepSeek             | API compatible OpenAI  | Catalogue intégré              |
| Moonshot AI (Kimi)   | API compatible OpenAI  | Catalogue intégré              |
| Qwen (Alibaba)       | API compatible OpenAI  | Catalogue intégré              |
| SpaceXAI             | API compatible OpenAI  | Catalogue intégré              |
| Z.ai (GLM)           | API compatible OpenAI  | Catalogue intégré              |
| Vercel AI Gateway    | API compatible OpenAI  | Endpoint models du fournisseur |
| Nous Portal (Hermes) | API compatible OpenAI  | Pas de catalogue               |

## Ce que la page affiche

Chaque connecteur possède sa propre section. Son en-tête nomme le fournisseur et énonce les faits réseau qui permettent de le reconnaître — le format d’API et l’hôte de l’endpoint, comme `API compatible OpenAI · openrouter.ai`, ou `endpoint défini par identifiant` pour un connecteur sans endpoint fixe. Sous l’en-tête, un badge nomme la provenance de la liste de modèles : **Catalogue intégré**, **Catalogue OpenRouter**, **Endpoint models du fournisseur** ou **Pas de catalogue**, suivi du nombre de modèles que cette source contient à cet instant.

En dessous se trouvent tes identifiants pour ce connecteur, une ligne chacun. Une ligne montre son nom, un aperçu masqué de la clé stockée ou le nom de la variable d’environnement qui la porte, un badge **Par défaut** sur celui vers lequel les requêtes retombent, un badge **Désactivé** sur ceux qui sont coupés, l’URL d’endpoint propre à l’identifiant là où le connecteur en réclame une, et le nombre de modèles que sa liste autorise. **Ajouter des identifiants** siège dans l’en-tête de section ; le menu d’actions de la ligne porte tout le reste.

Un connecteur qui a des identifiants mais aucun défaut est signalé sur place : les requêtes ne peuvent pas en choisir un automatiquement tant que tu n’en promeus pas un.

## Ajouter des identifiants

La boîte de dialogue appartient à un connecteur, donc elle ne propose que ce que ce connecteur accepte — on ne te demande jamais une URL de base que la plateforme connaît déjà.

<Steps>

<Step title="Ouvrir la boîte de dialogue du connecteur">

Trouve la section du fournisseur et clique sur **Ajouter des identifiants**. Le titre nomme le connecteur, et le sélecteur **Méthode d’authentification** liste exactement les méthodes qu’il prend en charge.

</Step>

<Step title="Choisir la méthode d’authentification">

La méthode change le reste du formulaire : un champ secret pour **Clé API** et **Clé d’abonnement**, un nom de variable pour **Variable d’environnement**, le formulaire complet du courtier pour **Courtier d’abonnement**.

</Step>

<Step title="Le nommer pour la personne qui lira ensuite">

**Nom** est ce que tous les écrans suivants montrent à la place du secret. Nomme-le pour son usage — `Clé de production`, `Équipe finance`, `Géré par les ops` — parce que c’est cette étiquette que quelqu’un choisira dans une liste des mois plus tard.

</Step>

<Step title="Décider si tu restreins">

**Modèles autorisés** est facultatif. Laisse le champ vide et l’identifiant peut utiliser tout le catalogue du connecteur ; remplis-le et il reste confiné à ta sélection.

</Step>

</Steps>

### Clé API

Colle le secret dans **Clé API**. Tale le stocke chiffré et ne le réaffiche jamais — la ligne montre un aperçu masqué, pas la clé. Pour faire tourner la clé, ouvre le menu de la ligne et choisis **Remplacer la clé API** ; le remplacement prend effet partout où ces identifiants servent, immédiatement.

### Variable d’environnement

Ici la clé n’entre jamais dans Tale. Elle reste sur le déploiement, et l’identifiant n’enregistre que le nom de la variable qui la porte. Tu ne saisis que le suffixe ; le préfixe réservé `TALE_PROVIDER_KEY_` est fixe et ne peut pas être effacé.

<Note>

Tout nom hors de ce préfixe est rejeté, donc le champ ne peut jamais pointer sur un secret de déploiement étranger. Les noms sont plafonnés à 40 caractères. La variable elle-même est fournie par qui exploite le déploiement — le versant opérateur est documenté dans [Fournisseurs](/fr/self-hosted/configuration/providers).

</Note>

### Abonnements et courtiers

Deux méthodes couvrent les abonnements plutôt que les clés API facturées à l’usage. **Clé d’abonnement** stocke directement le secret d’abonnement d’un fournisseur ; un abonnement Nous Portal en est un cas livré. **Courtier d’abonnement** pointe vers un endpoint qui distribue un pool de jetons OAuth rotatifs — la forme qu’utilise un abonnement Claude.

Le formulaire du courtier demande l’**Endpoint du courtier** et sa **Méthode HTTP**, puis comment Tale s’authentifie auprès du courtier sous **Authentification du courtier** : Aucune, Jeton Bearer ou En-tête personnalisé, avec un **Nom de l’en-tête** et le **Secret du courtier**, ou **Secret depuis une variable d’environnement** quand ce sont tes ops qui le détiennent. Le reste décrit la réponse : le **Chemin du tableau de jetons**, le **Champ du jeton**, la **Variable d’environnement cible** dans laquelle le jeton choisi est injecté, et une **Sélection du jeton** parmi Aléatoire, Premier utilisable ou Round-robin. **Avancé** porte le réglage fin : **Champ de statut**, **Valeur de statut actif**, **Champ d’expiration**, **Délai de la requête (ms)**, **Taille max de la réponse (octets)** et **Marge de sécurité avant expiration (ms)**.

<Info>

Les deux formes se consomment dans l’outillage propre du fournisseur plutôt que par un appel d’API ordinaire, et la boîte de dialogue le dit : **S’exécute en sandbox sur le harness de son fournisseur.** Un courtier d’abonnement Anthropic tourne sur le harness `claude-code`, une clé d’abonnement Nous Portal sur `hermes`. L’appel d’API direct n’est jamais proposé pour ces identifiants.

</Info>

## Les connecteurs dont l’endpoint est défini par identifiant

Azure OpenAI n’a pas d’endpoint fixe, parce que chaque ressource Azure sert le sien, sous la forme `https://<resource>.openai.azure.com/openai/v1`. L’en-tête de sa section indique que l’endpoint est défini par identifiant, et sa boîte de dialogue ajoute un champ **URL de l’endpoint** pour que chaque identifiant porte la ressource à laquelle il appartient.

Azure ne livre pas non plus de catalogue de modèles, et la raison mérite d’être connue avant de remplir le formulaire : sur Azure, l’id de modèle dans une requête est le nom de déploiement que tu as choisi dans la ressource, ce que Tale ne peut pas deviner. Saisis ces noms dans les **Modèles autorisés** de l’identifiant, séparés par des virgules. Sans eux, l’identifiant ne rend aucun modèle disponible.

## Choisir les identifiants par défaut

Une requête qui ne nomme aucun identifiant utilise le défaut du connecteur. C’est le cas de la majeure partie du trafic, donc le défaut est l’identifiant sur lequel le travail ordinaire doit atterrir — la clé de production partagée, pas l’expérimentation.

Ouvre le menu d’une ligne et choisis **Définir par défaut**. Un seul identifiant par connecteur tient ce rôle, et en promouvoir un autre le déplace. Un identifiant désactivé ne peut pas devenir le défaut. Laisse un connecteur sans défaut et la plateforme ne choisira pas à ta place : elle le dit sur la page, et les requêtes qui ne nomment pas d’identifiant n’ont plus rien à résoudre.

## Restreindre ce qu’un identifiant peut appeler

**Modèles autorisés** limite un identifiant à une partie des modèles de son connecteur. Avec un catalogue derrière, le champ est une sélection multiple cherchable ; sans catalogue, c’est une liste d’ids en texte libre. Laisse-le vide et tout le catalogue reste ouvert. Remplis-le et la ligne affiche le compte, tandis que ce qui n’y figure pas cesse de se résoudre via cet identifiant.

<Tip>

Une telle liste ne restreint qu’un identifiant. Pour décider d’un coup ce qu’une personne, une équipe ou un rôle peut choisir chez tous les fournisseurs, utilise les règles d’accès aux modèles sous [Contenu et modèles](/fr/platform/admin/governance/content-models). Les deux se composent : un modèle doit franchir les deux barrières avant d’apparaître dans un sélecteur.

</Tip>

## Garder les catalogues de modèles à jour

La carte **Catalogues de modèles** siège en haut de la page. **Actualiser les catalogues** recharge chaque catalogue en ligne et rend une ligne par connecteur — le nombre de modèles trouvés, ou l’erreur rencontrée, pour qu’un fournisseur en panne soit nommé plutôt qu’ignoré en silence.

Les catalogues livrés avec la plateforme n’en ont pas besoin : quand chaque connecteur en a un, la carte annonce qu’il n’y a rien à actualiser. Les catalogues en ligne sont mis en cache entre deux actualisations et aucune synchronisation ne tourne en arrière-plan — un modèle publié ce matin apparaît quand quelqu’un appuie sur le bouton.

## Désactiver et supprimer des identifiants

**Désactiver** coupe un identifiant en conservant sa configuration et ses modèles autorisés. Sers-t’en quand une clé est suspecte, qu’un quota est épuisé ou qu’un service est en pause — le réactiver tient en un clic et rien n’est à ressaisir.

<Warning>

La suppression est immédiate et totale. Les agents et les requêtes qui utilisent ces identifiants perdent aussitôt l’accès au fournisseur, donc redirige d’abord tout ce qui en dépend. Supprimer le défaut laisse le connecteur sans défaut jusqu’à ce que tu en promeuves un autre, ce que la confirmation t’annonce avant que tu valides.

</Warning>

## Où cela s’inscrit

Cette page est le sol sur lequel tout le reste repose : un agent, une réponse de chat, une étape de workflow, un embedding pour la base de connaissances se résolvent tous vers un modèle, et un modèle n’est joignable que si des identifiants de cette page peuvent l’appeler. Ce qu’il en reste côté choix est couvert par le [Catalogue de modèles](/fr/platform/models), la couche de gouvernance qui restreint encore par [Contenu et modèles](/fr/platform/admin/governance/content-models), et les variables de déploiement qu’un opérateur fournit par [Fournisseurs](/fr/self-hosted/configuration/providers).
