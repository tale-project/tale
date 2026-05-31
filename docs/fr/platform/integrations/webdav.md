---
title: WebDAV
description: Monte le dépôt de documents de ton organisation comme lecteur réseau dans Finder, Explorateur de fichiers ou n’importe quel client WebDAV. Génère un mot de passe applicatif sous Paramètres > WebDAV, puis connecte-toi depuis ton appareil.
---

WebDAV transforme le dépôt de documents de Tale en dossier distant que tu peux monter comme un lecteur réseau partagé. Depuis Finder sur Mac, l’Explorateur de fichiers sur Windows, l’application Fichiers sur iOS ou un gestionnaire de fichiers Linux, tu te connectes à une URL et tu t’authentifies avec un mot de passe applicatif ; de là, la hiérarchie des documents sous ton organisation apparaît comme des dossiers que tu peux parcourir, dans lesquels glisser des fichiers, et éditer sur place. C’est le même dépôt que le Hub de documents dans l’interface web — ce que tu vois dans une surface, tu le vois dans l’autre.

Cette page est le guide de configuration. La référence du protocole est sous [Développer > API WebDAV](/develop/webdav-api).

## Avant de commencer

Le point de terminaison WebDAV s’authentifie avec des **mots de passe applicatifs** — de courts secrets aléatoires que tu génères par appareil sous Paramètres. Ton mot de passe principal ne fonctionne pas ici ; la plateforme ne l’accepte pas sur ce point de terminaison, et ce serait dangereux (chaque client WebDAV stocke les identifiants dans le trousseau système, rejouable par tout ce qui peut le lire). Les mots de passe applicatifs permettent de cadrer l’accès par appareil et de révoquer par appareil sans rien tourner d’autre.

Une note sur le champ nom d’utilisateur : le mot de passe applicatif est le seul identifiant que le serveur vérifie réellement — la chaîne du nom d’utilisateur n’est pas comparée à ton enregistrement de compte. La convention est d’utiliser l’e-mail de ton compte Tale pour que les journaux d’audit et l’étiquette de ligne restent lisibles, et la plupart des UI clientes attendent de toute façon une chaîne en forme d’e-mail — mais la décision d’authentification se fait uniquement sur le mot de passe.

Tu as aussi besoin du **slug d’organisation** et de l’**URL du site** sous laquelle ton opérateur a déployé la plateforme. Les deux sont visibles dans le panneau Paramètres > WebDAV, et le panneau pré-remplit les détails de connexion sous le générateur de mot de passe.

Générer un mot de passe applicatif requiert les permissions **Admin** ou **Developer** dans l’organisation — la même capacité qui protège les clés API. Un simple membre qui ouvre Paramètres > WebDAV voit un écran d’accès refusé au lieu du générateur ; demande à une admin de l’organisation d’émettre un mot de passe ou de t’accorder la capacité.

## Générer un mot de passe applicatif

Ouvre **Paramètres > WebDAV** et tape un libellé décrivant l’usage — `MacBook Finder`, `iPhone Files`, `ops-laptop rclone`. Clique **Générer**. Le mot de passe complet apparaît une seule fois, avec un bouton de copie à côté ; copie-le dans la boîte de dialogue de connexion de ton appareil ou dans ton gestionnaire avant de fermer le panneau. Après fermeture, seuls les quatre premiers caractères restent visibles dans la table — assez pour identifier la ligne au moment de la révocation.

Tu peux détenir autant de mots de passe applicatifs que tu veux. Le plan est un par appareil — si tu perds l’appareil ou cesses de l’utiliser, révoque cette ligne sans perturber les autres clients configurés.

## Se connecter depuis macOS Finder

Dans Finder, presse **⌘K** (Se connecter au serveur). L’adresse est `https://<ton-site>/dav/<orgSlug>/documents/` — copie-la depuis le panneau des détails de connexion. Quand Finder demande des identifiants, utilise l’e-mail de ton compte Tale comme nom d’utilisateur et le mot de passe applicatif comme mot de passe. Finder monte le partage dans la barre latérale ; de là tu peux parcourir l’arborescence, glisser des fichiers pour téléverser, en sortir pour télécharger, renommer et supprimer sur place.

Le premier PROPFIND peut prendre quelques secondes sur une grande arborescence — Finder émet une énumération de profondeur 1 du chemin que tu montes, et la plateforme répond depuis le même arbre Convex que l’interface du Hub de documents. Après le premier chargement, la navigation est rapide.

## Se connecter depuis l’Explorateur de fichiers Windows

Dans **Ce PC**, choisis **Connecter un lecteur réseau**. Le dossier est `https://<ton-site>/dav/<orgSlug>/documents/`. Choisis une lettre, laisse **Se reconnecter à l’ouverture de session** coché, et clique **Se connecter à l’aide d’informations d’identification différentes**. Utilise l’e-mail de ton compte Tale et le mot de passe applicatif.

Windows impose une **limite de taille par défaut de 50 Mo** sur les fichiers transférés par WebDAV. Pour la relever, ouvre `regedit` et édite `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\WebClient\Parameters\FileSizeLimitInBytes` — règle-la sur une valeur décimale jusqu’à `4294967295` (4 Go). Redémarre ensuite le service **WebClient**. Cette limite est appliquée par Windows, pas par Tale ; les fichiers sous la limite passent sans la modification du registre.

Si l’Explorateur refuse avec **« Le dossier que vous avez saisi semble incorrect »**, la cause est presque toujours le refus par défaut de Windows d’utiliser Basic auth sur HTTPS aux origines non-443. Si ton déploiement tourne sur un port HTTPS non standard, règle `BasicAuthLevel` sous la même clé de registre à `2`.

## Se connecter depuis iOS Files

Dans Fichiers, tape sur le menu trois points en haut à droite et choisis **Se connecter au serveur**. L’adresse est la même `https://<ton-site>/dav/<orgSlug>/documents/`. Utilise l’e-mail de ton compte Tale et le mot de passe applicatif. iOS Files supporte la navigation et le téléchargement ; l’édition sur place est supportée pour les formats avec contrepartie iOS.

## Se connecter avec rclone

Pour les téléversements en lot ou la synchronisation scriptée, `rclone` est le client WebDAV le plus fiable :

```bash
rclone config create tale webdav \
    url=https://<ton-site>/dav/<orgSlug>/documents/ \
    vendor=other \
    user=<ton-email> \
    pass=$(rclone obscure '<mot-de-passe-applicatif>')
rclone copy ./local-folder tale: --progress
```

`vendor=other` est le bon réglage — le serveur WebDAV de Tale est générique, pas l’un des noms (`nextcloud`, `owncloud`, `sharepoint`) que rclone reconnaît nommément.

## Ce que tu peux et ne peux pas faire

Lire et écrire dans l’espace **documents** reflète ce que tu peux faire dans l’interface du Hub. Les fichiers téléversés via WebDAV atterrissent dans le même dépôt avec la même rétention, indexation et recherche ; le champ source du document est positionné à `webdav` pour les filtrer dans les journaux d’audit et les rapports. Les dossiers créés via MKCOL apparaissent immédiatement dans l’interface.

L’espace **.trash** est en lecture seule — `https://<ton-site>/dav/<orgSlug>/.trash/` liste les documents soft-supprimés encore dans le délai de rétention. Tu peux télécharger des fichiers depuis la corbeille pour récupération, mais les écritures y sont rejetées avec 403. Pour restaurer, passe par l’interface du Hub.

Certains clients appellent PROPFIND avec **Depth: infinity** — une requête pour vider l’arbre entier en une réponse. Tale rejette avec `403` pour éviter les réponses débordantes sur de gros dépôts. Tout client courant (Finder, Explorateur, iOS, rclone, cadaver) utilise Depth 0 ou 1, tu ne devrais jamais croiser ce cas en pratique.

## Verrouillage

Tale implémente les verrous WebDAV Class 2. Quand tu ouvres un fichier dans une application qui respecte les verrous (Microsoft Office, LibreOffice, BBEdit, certains éditeurs de texte), l’app pose un LOCK sur la ressource pour la durée de l’édition ; un autre client qui tente d’écrire sur le même chemin pendant cette fenêtre obtient `423 Locked`. Les verrous expirent automatiquement après au plus une heure même en cas de crash de l’app ; si tu dois libérer un verrou bloqué avant, révoque le mot de passe applicatif qui le détient — Tale libère tout verrou détenu sous un mot de passe révoqué dans la même opération.

## Révoquer

Pour révoquer un mot de passe applicatif, clique sur l’icône corbeille à côté de la ligne. La ligne reste dans la table pour la piste d’audit et porte un badge **révoqué**. Toute requête en cours authentifiée avec le mot de passe révoqué se termine ; la suivante est rejetée. Pas d’annulation — génère un nouveau mot de passe si tu révoques la mauvaise ligne.

## Dépannage

Une requête qui renvoie `401` après avoir fonctionné hier signifie presque toujours que le mot de passe applicatif a été révoqué ou expiré. Le champ nom d’utilisateur lui-même n’est pas vérifié — seul le mot de passe l’est — donc une faute de frappe dans le nom d’utilisateur ne déclenche pas de 401, mais un mot de passe faux, révoqué ou mal collé, lui, le déclenche.

Une requête qui renvoie `423 Locked` signifie que le chemin est verrouillé par un autre client. Attends l’expiration, change de nom de fichier ou révoque le mot de passe applicatif qui détient le verrou.

Un montage Finder qui bloque à la première navigation signifie en général que Convex est lent à répondre à un grand PROPFIND sur un arbre profond — patiente. S’il ne revient jamais, vérifie que ton compte est toujours membre du slug d’organisation dans l’URL ; le point de terminaison WebDAV rejette les requêtes des non-membres avec `403`.

Un `502` sur GET indique que la plateforme a pu récupérer les métadonnées du document mais a échoué à récupérer les octets du blob depuis le stockage. Vérifie les journaux Convex pour les erreurs de stockage et confirme que `ADMIN_KEY` est défini dans l’environnement de la plateforme — le serveur WebDAV lit les blobs via un client admin-authentifié.

## Sécurité

WebDAV utilise HTTP Basic, ce qui veut dire que le mot de passe applicatif est envoyé à chaque requête — pas de cookie de session qui expire, pas de jeton de rafraîchissement, juste l’identifiant brut sur le câble chaque fois que le client parle au serveur. Ne monte le partage que sur HTTPS ; sur HTTP en clair, quiconque se trouve sur le chemin entre toi et le serveur peut lire le mot de passe. Laisse le trousseau de ton OS (macOS Keychain, Windows Credential Manager, GNOME Keyring) tenir le mot de passe — ne le colle jamais dans la forme abrégée `https://user:pass@host/...`, car la plupart des outils consignent les URL dans l’historique du shell, les rapports de crash et les journaux d’accès du proxy, où l’identifiant survivrait bien plus longtemps que le montage.

Si tu soupçonnes une fuite du mot de passe, révoque cette ligne dans **Paramètres > WebDAV** immédiatement. La révocation est instantanée ; la prochaine requête authentifiée avec le mot de passe fuité est rejetée. Les autres appareils qui utilisent leurs propres mots de passe applicatifs ne sont pas affectés.

## Comment ça s’intègre

WebDAV se trouve à côté du [Hub de documents](/platform/knowledge/documents) (les mêmes données, vues via l’interface web), des [Intégrations](/platform/integrations/overview) (systèmes tiers depuis lesquels Tale tire) et des [clés d’API](/platform/admin/api-keys) (identifiants à l’échelle de l’organisation pour l’API REST). WebDAV est par utilisateur — les identifiants authentifient comme toi, cadrés aux organisations dont tu es membre. Pour l’import de documents machine à machine, les clés d’API plus l’API REST sont en général un meilleur choix.
