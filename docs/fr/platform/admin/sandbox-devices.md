---
title: Exécuter les sandboxes sur tes propres appareils
description: Connecte une machine Linux ou macOS avec Docker pour que les sandboxes des agents et des automatisations de ton organisation s’y exécutent.
---

Un appareil est une machine que tu connectes à ton organisation pour que ses sandboxes s’y exécutent au lieu du serveur Tale : un poste de travail inutilisé, un serveur de build ou un Mac qui a de la capacité à partager. Les Propriétaires et Admins ajoutent et retirent des appareils dans **Paramètres > Sandboxes**. Les Développeurs voient la liste.

## Vérifier ce dont la machine a besoin

- Linux sur x86_64 ou arm64, ou macOS sur Apple Silicon ou Intel.
- Docker : Docker Engine sous Linux ; Docker Desktop, OrbStack ou Colima sous macOS. Si Docker manque, la CLI Tale propose de l’installer.
- Un accès HTTPS sortant vers ton site Tale. C’est l’appareil qui se connecte à Tale ; rien ne doit joindre la machine depuis l’extérieur, donc cela fonctionne aussi derrière un routeur ou un pare-feu.
- De l’espace disque pour les images de sandbox, plusieurs gigaoctets, et pour les espaces de travail qu’il accueillera.

Par défaut, un appareil exécute une sandbox pour deux processeurs et pour 4 Gio de mémoire que Docker peut utiliser, jusqu’à 16 à la fois, car chaque sandbox d’agent reçoit 2 processeurs et 4 Gio. Tu peux choisir un autre nombre au moment de connecter la machine.

Ce nombre est un plafond. Avant de démarrer une sandbox, l’appareil vérifie aussi la mémoire disponible sur l’hôte et l’espace disque libre pour les espaces de travail. Une place libre ne suffit donc pas toujours à accueillir une sandbox de plus.

<Warning>

Un appareil exécute le travail de ton organisation. Les espaces de travail des agents, les fichiers qu’ils traitent et les identifiants de courte durée qu’une tâche utilise passent par la machine, et toute personne disposant d’un accès administrateur à celle-ci peut les lire. Ne connecte que des machines que tu contrôles et auxquelles tu fais autant confiance qu’au serveur Tale. À l’inverse, le site Tale décide de ce qui s’exécute sur l’appareil, y compris les mises à jour qu’il installe de lui-même : ne connecte une machine qu’à un site Tale auquel tu la confies.

</Warning>

## Ajouter un appareil

<Steps>

<Step title="Copier la commande">

Ouvre **Paramètres > Sandboxes** et choisis **Ajouter un appareil** dans la section **Appareils**. Sous **Installer et connecter**, choisis **Copier la commande**.

La commande ne fonctionne qu’une fois, dans l’heure. Elle contient un jeton à usage unique que la machine échange contre ses propres identifiants.

<Frame caption="Ajouter un appareil : la commande d’installation et de connexion, et la plus courte pour une machine où la CLI est déjà installée. Le jeton affiché est une valeur factice.">

![La boîte de dialogue Ajouter un appareil avec la commande Installer et connecter, qui installe la CLI Tale et lance tale sandbox connect avec l’adresse du déploiement et un jeton à usage unique, le bouton Copier la commande, les prérequis, la mention que la commande ne fonctionne qu’une fois dans l’heure, la commande plus courte pour une machine où la CLI est déjà installée et l’état qui attend la connexion de l’appareil.](/images/platform/sandbox-add-device.webp)

</Frame>

</Step>

<Step title="L’exécuter sur la machine">

Colle la commande dans un terminal sur la machine et exécute-la. Elle installe la CLI Tale et connecte la machine :

```text
Connecting this machine to https://your-org.tale.dev as "studio-mac"…
Starting the sandbox device (Tale 0.5.60). The first start downloads the sandbox images, which can take a few minutes…
```

Si la CLI Tale est déjà installée sur la machine, exécute la commande plus courte affichée sous **La CLI Tale est déjà installée ? Exécute plutôt ceci**.

</Step>

<Step title="Vérifier qu’il est en ligne">

Dès que la machine joint Tale, la boîte de dialogue affiche **studio-mac est connecté.** et l’appareil apparaît dans la liste **Appareils** avec le statut **En ligne**. Choisis **Terminé**.

</Step>

</Steps>

L’appareil continue de fonctionner après un redémarrage de la machine, tant que Docker démarre avec elle. Quand Tale est mis à jour, l’appareil passe tout seul à la même version.

## Comprendre où s’exécutent les sandboxes

Les nouveaux espaces de travail des agents et des automatisations démarrent sur un appareil connecté qui a de la place. S’il n’y en a aucun, ils démarrent sur le serveur Tale. Un espace de travail reste, avec ses fichiers, sur la machine où il a démarré : un agent qui a déjà un espace de travail sur le serveur continue donc de l’utiliser. Les pages rendues pour l’exploration des sites web restent toujours sur le serveur.

Quand plusieurs appareils ont de la place, Tale tient compte à la fois des places libres et de la marge de mémoire mesurée. Si un appareil refuse un démarrage faute de capacité, un autre appareil ou le serveur peut le prendre en charge. Si la réponse est perdue ou si l’appareil renvoie une erreur serveur, les nouvelles tentatives restent sur cet appareil : il a peut-être déjà créé l’espace de travail.

Dès que ton organisation a un appareil, la liste **Espaces de travail** indique où s’exécute chaque espace de travail : **Sur le serveur** ou sur un appareil désigné par son nom. Tant qu’un appareil est hors ligne, le travail qui a besoin d’un de ses espaces de travail échoue avec un message indiquant que l’appareil n’est pas connecté. Relance-le quand l’appareil est de nouveau en ligne ; un espace de travail ne passe jamais tout seul sur une autre machine.

Les sandboxes d’un appareil accèdent à Internet par la connexion de la machine, via le même proxy de sortie que sur le serveur. Le proxy bloque les adresses des réseaux privés, si bien que les sandboxes ne peuvent pas joindre les autres machines de ton réseau local.

Les appareils connectés relèvent aussi le plafond des [limites d’activité](/fr/platform/admin/sandboxes#modifier-une-limite-dactivite) de ton organisation : leur total peut utiliser la capacité du déploiement plus les sandboxes de tes appareils.

## Lire la liste des appareils

| Colonne | Ce qu’elle indique |
| --- | --- |
| **Appareil** | Le nom avec lequel la machine s’est connectée, et son système d’exploitation. |
| **Statut** | **En ligne**, **Mise à jour en cours**, **Mise à jour requise**, **Échec de la mise à jour** ou **Hors ligne**. |
| **Sandboxes** | Les sandboxes en cours d’exécution, et combien l’appareil en exécute à la fois. |
| **Machine** | Les processeurs et la mémoire que Docker peut utiliser sur la machine. |
| **Version** | La version de Tale qu’exécute l’appareil. |
| **Dernier contact** | **Maintenant** tant qu’il est connecté, sinon le moment de son dernier contact. |

Un appareil qui n’a pas la même version que le serveur ne prend plus de nouvelles sandboxes tant qu’il n’est pas mis à jour. **Mise à jour requise** signifie que l’appareil ne se met pas à jour tout seul ; **Échec de la mise à jour** signifie que sa dernière mise à jour automatique n’a pas abouti. Dans les deux cas, exécute `tale sandbox update` sur la machine.

## Gérer un appareil depuis la machine

Exécute ces commandes sur l’appareil lui-même :

| Commande | Ce qu’elle fait |
| --- | --- |
| `tale sandbox status` | Affiche la connexion, l’organisation, la version et les sandboxes en cours d’exécution. |
| `tale sandbox logs --follow` | Suit le journal de l’appareil. |
| `tale sandbox update` | Passe immédiatement l’appareil à la version du serveur, avec les adresses actuelles du serveur pour ses sandboxes. |
| `tale sandbox disconnect` | Retire l’appareil de son organisation, arrête ses sandboxes et supprime leurs espaces de travail de la machine. Ajoute `--keep-data` pour conserver les espaces de travail. |

## Retirer un appareil

Dans la liste **Appareils**, ouvre le menu de la ligne de l’appareil, choisis **Retirer** et confirme. L’appareil cesse immédiatement d’exécuter des sandboxes pour ton organisation. Ses espaces de travail restent sur la machine mais ne sont plus accessibles depuis Tale ; leurs agents repartent avec de nouveaux espaces de travail à leur prochaine exécution.

Pour nettoyer aussi la machine, exécute `tale sandbox disconnect` sur celle-ci.

## Dépanner un appareil qui ne se connecte pas

- **La commande a expiré ou a déjà été utilisée.** Choisis de nouveau **Ajouter un appareil** pour obtenir une nouvelle commande.
- **L’appareil a démarré mais n’a pas encore joint le serveur.** Exécute `tale sandbox logs --follow` sur la machine et vérifie qu’elle peut ouvrir des connexions HTTPS vers ton site Tale, y compris à travers un éventuel proxy.
- **La connexion échoue avec une erreur de certificat.** La machine doit faire confiance au certificat TLS de ton site Tale. Un déploiement qui utilise un certificat auto-signé ne peut pas accueillir d’appareils.
- **Ajouter un appareil est indisponible, et la section indique que le service de sandbox n’accepte pas d’appareils.** Le déploiement fonctionne sans son hub d’appareils. Sur un déploiement auto-hébergé, l’opérateur l’active comme décrit dans [Appareils de sandbox](/fr/self-hosted/configuration/environment-reference#sandbox-devices).
