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
3. Renseigne un **Nom** qui indique l’usage, comme `Clé de production` ou `Équipe finance`, puis les champs requis par la méthode.
4. Vérifie la liste **Modèles autorisés**. Pour un fournisseur avec catalogue, une liste vide autorise les modèles du catalogue. Sans catalogue, tu dois préciser les identifiants des modèles.
5. Sélectionne **Ajouter**. Vérifie la ligne créée et définis-la par défaut pour ce fournisseur si les requêtes habituelles doivent l’utiliser.

Ouvre un chat et examine le sélecteur de modèle. Le modèle doit être disponible via des identifiants actifs et autorisé par les règles de l’organisation. Enregistrer des identifiants ne prouve pas que le fournisseur acceptera les requêtes : envoie un court message de test avec le modèle prévu.

## Choisir la méthode d’authentification

| Méthode | Informations à fournir | Usage |
| --- | --- | --- |
| **Clé API** | La clé secrète du fournisseur | Accès API facturé à l’usage. Le secret enregistré est chiffré et seul un fragment masqué reste visible. |
| **Variable d'environnement** | Le nom d’une variable du déploiement | L’opérateur gère le secret hors de l’interface. Son nom doit commencer par `TALE_PROVIDER_KEY_`. |
| **Clé d'abonnement** | Un secret d’abonnement pris en charge | Exécution dans l’environnement d’agent du fournisseur, plutôt que par un appel API direct. |
| **Courtier d'abonnement** | L’adresse du courtier et la configuration de sa réponse | Le déploiement obtient des tokens d’abonnement utilisables auprès du courtier. |

Seules les méthodes du fournisseur sélectionné apparaissent. Référencer une variable ne la crée pas : demande à l’opérateur de la fournir selon le [guide de configuration des fournisseurs](/fr/self-hosted/configuration/providers).

Pour un courtier d’abonnement, précise l’authentification de Tale auprès du courtier, le chemin de la liste de tokens et de leur valeur dans la réponse, ainsi que la variable cible qui reçoit le token. Choisis la stratégie de sélection et vérifie délai, taille de réponse, expiration et statut actif sous **Avancé**. Ces valeurs doivent correspondre au format réel de la réponse du courtier ; une clé API de fournisseur ne les remplace pas.

## Configurer Azure ou une adresse propre au compte

Azure OpenAI demande une **URL de l'endpoint**, généralement `https://<resource>.openai.azure.com/openai/v1`. Les identifiants appartiennent à cette ressource. Les identifiants de modèle Azure sont les noms de déploiement définis dans la ressource : saisis-les dans la liste **Modèles autorisés**. Sans catalogue, laisser cette liste vide ne rend aucun modèle disponible.

Utilise les adresses et identifiants documentés par le fournisseur. Le nom affiché sur une page commerciale n’est pas forcément celui que son API accepte.

## Connecter un serveur sur ton réseau

Demande à l’opérateur de préparer la définition du fournisseur, l’accès réseau et la politique du déploiement, puis suis [Connecter un serveur de modèles local](/fr/tutorials/admin/connect-local-provider). Enregistrer des identifiants n’autorise pas une adresse privée. Teste le modèle voulu dans un chat et, si des agents de programmation l’utiliseront, dans une session d’agent. Leur trafic passe par une passerelle distincte qui doit aussi disposer de l’accès réseau et faire confiance au certificat.

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

Supprimer des identifiants retire l’accès aux appelants qui en dépendent. Migre-les d’abord. Si tu supprimes le choix par défaut, désigne son remplacement pour que les appels sans sélection explicite puissent encore fonctionner.

</Warning>
