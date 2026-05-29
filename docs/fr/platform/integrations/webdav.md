---
title: WebDAV
description: Montez le dépôt de documents de votre organisation comme lecteur réseau dans Finder, Explorateur de fichiers ou n'importe quel client WebDAV. Générez un mot de passe applicatif sous Paramètres > WebDAV, puis connectez-vous depuis votre appareil.
---

WebDAV transforme le dépôt de documents de Tale en dossier distant que vous pouvez monter comme un lecteur réseau partagé. Depuis Finder sur Mac, l'Explorateur de fichiers sur Windows, l'application Fichiers sur iOS ou un gestionnaire de fichiers Linux, vous vous connectez à une URL et vous authentifiez avec un mot de passe applicatif ; de là, la hiérarchie des documents sous votre organisation apparaît comme des dossiers que vous pouvez parcourir, dans lesquels glisser des fichiers, et éditer sur place. C'est le même dépôt que le Hub de documents dans l'interface web — ce que vous voyez dans une surface, vous le voyez dans l'autre.

Cette page est le guide de configuration. La référence du protocole est sous [Développer > API WebDAV](/develop/webdav-api).

## Avant de commencer

Le point de terminaison WebDAV s'authentifie avec des **mots de passe applicatifs** — de courts secrets aléatoires que vous générez par appareil sous Paramètres. Votre mot de passe principal ne fonctionne pas ici ; la plateforme ne l'accepte pas sur ce point de terminaison, et ce serait dangereux (chaque client WebDAV stocke les identifiants dans le trousseau système, rejouable par tout ce qui peut le lire). Les mots de passe applicatifs permettent de cadrer l'accès par appareil et de révoquer par appareil sans rien tourner d'autre.

Vous avez aussi besoin du **slug d'organisation** et de l'**URL du site** sous laquelle votre opérateur a déployé la plateforme. Les deux sont visibles dans le panneau Paramètres > WebDAV, et le panneau pré-remplit les détails de connexion sous le générateur de mot de passe.

## Générer un mot de passe applicatif

Ouvrez **Paramètres > WebDAV** et tapez un libellé décrivant l'usage — `MacBook Finder`, `iPhone Files`, `ops-laptop rclone`. Cliquez **Générer**. Le mot de passe complet apparaît une seule fois, avec un bouton de copie à côté ; copiez-le dans la boîte de dialogue de connexion de votre appareil ou dans votre gestionnaire avant de fermer le panneau. Après fermeture, seuls les quatre premiers caractères restent visibles dans la table — assez pour identifier la ligne au moment de la révocation.

Vous pouvez détenir autant de mots de passe applicatifs que vous voulez. Le plan est un par appareil — si vous perdez l'appareil ou cessez de l'utiliser, révoquez cette ligne sans perturber les autres clients configurés.

## Se connecter depuis macOS Finder

Dans Finder, pressez **⌘K** (Se connecter au serveur). L'adresse est `https://<votre-site>/dav/<orgSlug>/documents/` — copiez-la depuis le panneau des détails de connexion. Quand Finder demande des identifiants, utilisez l'e-mail de votre compte Tale comme nom d'utilisateur et le mot de passe applicatif comme mot de passe. Finder monte le partage dans la barre latérale ; de là vous pouvez parcourir l'arborescence, glisser des fichiers pour téléverser, en sortir pour télécharger, renommer et supprimer sur place.

Le premier PROPFIND peut prendre quelques secondes sur une grande arborescence — Finder émet une énumération de profondeur 1 du chemin que vous montez, et la plateforme répond depuis le même arbre Convex que l'interface du Hub de documents. Après le premier chargement, la navigation est rapide.

## Se connecter depuis l'Explorateur de fichiers Windows

Dans **Ce PC**, choisissez **Connecter un lecteur réseau**. Le dossier est `https://<votre-site>/dav/<orgSlug>/documents/`. Choisissez une lettre, laissez **Se reconnecter à l'ouverture de session** coché, et cliquez **Se connecter à l'aide d'informations d'identification différentes**. Utilisez l'e-mail de votre compte Tale et le mot de passe applicatif.

Windows impose une **limite de taille par défaut de 50 Mo** sur les fichiers transférés par WebDAV. Pour la relever, ouvrez `regedit` et éditez `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\WebClient\Parameters\FileSizeLimitInBytes` — réglez-la sur une valeur décimale jusqu'à `4294967295` (4 Go). Redémarrez ensuite le service **WebClient**. Cette limite est appliquée par Windows, pas par Tale ; les fichiers sous la limite passent sans la modification du registre.

Si l'Explorateur refuse avec **« Le dossier que vous avez saisi semble incorrect »**, la cause est presque toujours le refus par défaut de Windows d'utiliser Basic auth sur HTTPS aux origines non-443. Si votre déploiement tourne sur un port HTTPS non standard, réglez `BasicAuthLevel` sous la même clé de registre à `2`.

## Se connecter depuis iOS Files

Dans Fichiers, tapez sur le menu trois points en haut à droite et choisissez **Se connecter au serveur**. L'adresse est la même `https://<votre-site>/dav/<orgSlug>/documents/`. Utilisez l'e-mail de votre compte Tale et le mot de passe applicatif. iOS Files supporte la navigation et le téléchargement ; l'édition sur place est supportée pour les formats avec contrepartie iOS.

## Se connecter avec rclone

Pour les téléversements en lot ou la synchronisation scriptée, `rclone` est le client WebDAV le plus fiable :

```bash
rclone config create tale webdav \
    url=https://<votre-site>/dav/<orgSlug>/documents/ \
    vendor=other \
    user=<votre-email> \
    pass=$(rclone obscure '<mot-de-passe-applicatif>')
rclone copy ./local-folder tale: --progress
```

`vendor=other` est le bon réglage — le serveur WebDAV de Tale est générique, pas l'un des noms (`nextcloud`, `owncloud`, `sharepoint`) que rclone reconnaît nommément.

## Ce que vous pouvez et ne pouvez pas faire

Lire et écrire dans l'espace **documents** reflète ce que vous pouvez faire dans l'interface du Hub. Les fichiers téléversés via WebDAV atterrissent dans le même dépôt avec la même rétention, indexation et recherche ; le champ source du document est positionné à `webdav` pour les filtrer dans les journaux d'audit et les rapports. Les dossiers créés via MKCOL apparaissent immédiatement dans l'interface.

L'espace **.trash** est en lecture seule — `https://<votre-site>/dav/<orgSlug>/.trash/` liste les documents soft-supprimés encore dans le délai de rétention. Vous pouvez télécharger des fichiers depuis la corbeille pour récupération, mais les écritures y sont rejetées avec 403. Pour restaurer, passez par l'interface du Hub.

Certains clients appellent PROPFIND avec **Depth: infinity** — une requête pour vider l'arbre entier en une réponse. Tale rejette avec `403` pour éviter les réponses débordantes sur de gros dépôts. Tout client courant (Finder, Explorateur, iOS, rclone, cadaver) utilise Depth 0 ou 1, vous ne devriez jamais croiser ce cas en pratique.

## Verrouillage

Tale implémente les verrous WebDAV Class 2. Quand vous ouvrez un fichier dans une application qui respecte les verrous (Microsoft Office, LibreOffice, BBEdit, certains éditeurs de texte), l'app pose un LOCK sur la ressource pour la durée de l'édition ; un autre client qui tente d'écrire sur le même chemin pendant cette fenêtre obtient `423 Locked`. Les verrous expirent automatiquement après au plus une heure même en cas de crash de l'app ; si vous devez libérer un verrou bloqué avant, révoquez le mot de passe applicatif qui le détient — Tale libère tout verrou détenu sous un mot de passe révoqué dans la même opération.

## Révoquer

Pour révoquer un mot de passe applicatif, cliquez sur l'icône corbeille à côté de la ligne. La ligne reste dans la table pour la piste d'audit et porte un badge **révoqué**. Toute requête en cours authentifiée avec le mot de passe révoqué se termine ; la suivante est rejetée. Pas d'annulation — générez un nouveau mot de passe si vous révoquez la mauvaise ligne.

## Dépannage

Une requête qui renvoie `401` après avoir fonctionné hier signifie presque toujours que le mot de passe applicatif a été révoqué ou que vous avez tapé le mauvais nom d'utilisateur. Utilisez l'e-mail avec lequel vous vous connectez, pas votre nom d'affichage.

Une requête qui renvoie `423 Locked` signifie que le chemin est verrouillé par un autre client. Attendez l'expiration, changez de nom de fichier ou révoquez le mot de passe applicatif qui détient le verrou.

Un montage Finder qui bloque à la première navigation signifie en général que Convex est lent à répondre à un grand PROPFIND sur un arbre profond — patientez. S'il ne revient jamais, vérifiez que votre compte est toujours membre du slug d'organisation dans l'URL ; le point de terminaison WebDAV rejette les requêtes des non-membres avec `403`.

Un `502` sur GET indique que la plateforme a pu récupérer les métadonnées du document mais a échoué à récupérer les octets du blob depuis le stockage. Vérifiez les journaux Convex pour les erreurs de stockage et confirmez que `ADMIN_KEY` est défini dans l'environnement de la plateforme — le serveur WebDAV lit les blobs via un client admin-authentifié.

## Où cela s'intègre

WebDAV se trouve à côté du [Hub de documents](/platform/knowledge/documents) (les mêmes données, vues via l'interface web), des [Intégrations](/platform/integrations/overview) (systèmes tiers depuis lesquels Tale tire) et des [clés d'API](/platform/admin/api-keys) (identifiants à l'échelle de l'organisation pour l'API REST). WebDAV est par utilisateur — les identifiants authentifient comme vous, cadrés aux organisations dont vous êtes membre. Pour l'import de documents machine à machine, les clés d'API plus l'API REST sont en général un meilleur choix.
