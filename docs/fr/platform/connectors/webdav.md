---
title: WebDAV
description: Monte les documents de ton organisation comme un lecteur réseau dans le Finder, l’Explorateur de fichiers ou n’importe quel client WebDAV.
---

WebDAV transforme le magasin de documents de Tale en un dossier distant que tu montes comme n’importe quel lecteur réseau partagé. Le magasin sous-jacent est le même que celui que montre le hub documentaire — ce que tu déposes dans le dossier monté apparaît dans l’interface, et inversement. Tout ce qu’il te faut tient sur un panneau : **Paramètres > API > WebDAV** porte les détails de connexion et le générateur de mots de passe applicatifs.

<Frame caption="Paramètres > API > WebDAV — les détails de connexion préremplis en haut, le générateur de mots de passe applicatifs en dessous.">

![La page des paramètres WebDAV montrant une URL de connexion, un champ de nom d’utilisateur avec l’e-mail du compte, une explication indiquant que le mot de passe est un mot de passe applicatif généré, et un tableau de mots de passe applicatifs qui tient deux entrées — Design workstation et MacBook Pro, chacune avec son seul préfixe et sa date de création — à côté d’un bouton Générer.](/images/platform/settings-webdav.webp)

</Frame>

## Générer un mot de passe applicatif

Le point de terminaison s’authentifie avec des mots de passe applicatifs — de courts secrets que tu frappes par appareil — parce que chaque client WebDAV stocke son identifiant dans le trousseau du système, et qu’un secret cadré et révocable y a sa place, pas le mot de passe de ton compte. Le mot de passe de ton compte ne fonctionne pas sur ce point de terminaison.

Clique sur **Générer**, étiquette le mot de passe d’après l’appareil (`MacBook Finder`, `ops-laptop rclone`) et copie-le — un par appareil ; le mot de passe complet ne s’affiche qu’une seule fois. Ensuite le tableau ne garde que le libellé et un court préfixe, assez pour reconnaître la ligne quand tu la révoques. Générer exige la même capacité que celle qui garde les clés API ; les simples Membres demandent à un admin.

Pour le nom d’utilisateur, utilise l’e-mail de ton compte Tale. Seul le mot de passe est réellement vérifié, mais l’e-mail garde les lignes d’audit lisibles et correspond à ce que les boîtes de dialogue des clients attendent.

## Se connecter depuis ton appareil

L’adresse est l’URL du panneau — `https://<your-site>/dav/<orgSlug>/documents/`.

<Tabs>

<Tab title="Finder macOS">

Appuie sur **⌘K** (Se connecter au serveur), colle l’URL et connecte-toi avec ton e-mail et le mot de passe applicatif. Le partage se monte dans la barre latérale ; glisse des fichiers dedans pour téléverser, dehors pour télécharger, et renomme ou supprime sur place. Le premier listage d’une grande arborescence peut prendre quelques secondes.

</Tab>

<Tab title="Windows">

Dans **Ce PC**, choisis **Connecter un lecteur réseau**, colle l’URL comme dossier et coche **Se connecter à l’aide d’informations d’identification différentes**. Windows plafonne les transferts WebDAV à 50 Mo par fichier par défaut — augmente `FileSizeLimitInBytes` sous la clé de registre `WebClient\Parameters` et redémarre le service WebClient. Sur un port HTTPS non standard, règle `BasicAuthLevel` à `2` sous la même clé.

</Tab>

<Tab title="Fichiers iOS">

Touche le menu à trois points, choisis **Se connecter au serveur** et saisis la même URL et les mêmes identifiants. Fichiers prend en charge la navigation et le téléchargement ; la modification sur place fonctionne pour les formats dotés d’une app iOS.

</Tab>

<Tab title="rclone">

```bash
rclone config create tale webdav \
    url=https://<your-site>/dav/<orgSlug>/documents/ \
    vendor=other \
    user=<your-email> \
    pass=$(rclone obscure '<app-password>')
rclone copy ./local-folder tale: --progress
```

`vendor=other` est correct — le serveur de Tale est générique, pas une saveur nommée que rclone reconnaît.

</Tab>

</Tabs>

## Ce que le montage sait faire

Les lectures et écritures reflètent tes permissions du hub documentaire, les fichiers que tu téléverses s’indexent et se recherchent comme des téléversements directs, et leur champ source est réglé sur `webdav` pour le filtrage dans les vues d’audit. Les fichiers de projet font exception : l’onglet **Connaissances** d’un projet est scopé à ce seul projet et n’apparaît jamais via WebDAV, le montage ne montre donc que le hub documentaire de l’organisation. L’espace `.trash/` liste les documents supprimés de façon réversible, en lecture seule — télécharge pour récupérer, restaure via l’interface. Les éditeurs qui prennent des verrous WebDAV (Office, LibreOffice) les obtiennent ; une écriture concurrente pendant une modification renvoie `423 Locked`.

## Révoquer

Révoque un mot de passe avec l’icône corbeille de sa ligne — la requête suivante qui le porte est rejetée, les autres appareils ne sont pas touchés, et les verrous qu’il tenait sont libérés. Il n’y a pas d’annulation ; frappe un nouveau mot de passe si tu révoques la mauvaise ligne.

<Warning>

L’authentification Basic envoie le mot de passe applicatif à chaque requête. Ne monte qu’en HTTPS, garde le mot de passe dans le trousseau du système et ne le colle jamais dans une URL `https://user:pass@host/` — l’historique du shell et les journaux de proxy survivent au montage. Révoque immédiatement au moindre soupçon de fuite.

</Warning>

## Où cela s’inscrit

WebDAV est la porte par utilisateur, côté appareil, vers les mêmes données que le [hub documentaire](/fr/platform/knowledge/documents) ; le protocole réseau vit sous [API WebDAV](/fr/develop/webdav-api). Pour les imports machine à machine, les [clés API](/fr/platform/admin/api-keys) plus l’API REST sont en général le meilleur choix.
