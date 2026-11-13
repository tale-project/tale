---
title: Exécuter Tale sur Incus
description: Exécute un déploiement Tale géré sous forme d’instances Incus plutôt que de conteneurs Docker Compose, du contrat de nœud et de sa vérification jusqu’aux limites à prévoir.
---

Un déploiement géré peut tourner sur [Incus](https://linuxcontainers.org/incus/) au lieu de Docker Compose : chaque service de la stack devient une instance Incus dans un projet restreint d’un hôte Linux, et les sessions sandbox tournent à côté, dans un projet à elles. La CLI Tale compile pour cela le `compose.yml` de la release elle-même, si bien que les services, les images et les réglages sont ceux du runtime Docker. Cette page te mène d’un hôte Incus à un déploiement en marche et nomme les limites à prévoir.

<Warning>

Le runtime Incus est **expérimental** dans Tale 0.5.x. Docker Compose reste le runtime par défaut et le runtime pris en charge. Seul le parcours des [déploiements gérés](/fr/self-hosted/install/cli-install#managed-deployments) tourne sur Incus : un workspace qui déclare le runtime Incus est refusé par `tale deploy`, `tale status` et les autres commandes de la stack, et la mise à niveau d’un déploiement en marche sur Incus est refusée tant que la CLI ne peut pas y prendre son snapshot de reprise.

</Warning>

## Choisir le runtime Incus {#choose-incus}

Choisis Incus quand un hôte fait déjà tourner Incus pour d’autres charges, ou quand tu veux la stack et ses sessions dans des projets Incus restreints, sans démon Docker. La CLI dialogue avec Incus par son API REST, avec un certificat client restreint au projet de la stack, et n’a besoin des droits d’administration de l’hôte que pour le bootstrap initial. Garde Docker Compose quand tu exploites un workspace avec `tale deploy`, quand tu développes en local avec `tale dev`, qui ne tourne que sur Docker, ou quand tu as besoin d’appareils sandbox connectés.

## Vérifier les prérequis {#prerequisites}

| Prérequis | Pourquoi il compte |
| --- | --- |
| Un hôte Linux avec Incus 7.2 ou plus récent, hors cluster | La CLI a besoin des extensions d’API `instance_oci`, `instance_oci_entrypoint`, `oci_network_config`, `storage_shifted`, `storage_initial_owner`, `file_storage_volume`, `projects_restricted_backups_and_snapshots`, `projects_restricted_image_servers` et `instance_auto_restart`, et refuse un serveur auquel il en manque une ou qui fait partie d’un cluster. |
| Linux 5.12 ou plus récent avec les montages idmappés | Chaque volume de la stack est monté décalé (`security.shifted`), ce qui demande les montages idmappés. |
| Un pool de stockage `zfs`, `btrfs` ou `lvm` | Ces pilotes font respecter la taille d’un volume. Un pool ZFS demande OpenZFS 2.2 ou plus récent, dont les datasets prennent en charge les montages idmappés. Le bootstrap utilise le pool créé à l’installation d’Incus et n’en crée aucun. |
| Un hôte `x86_64` | Les bundles gérés exigent des images natives pour leur plateforme déclarée, et le stockage objet fourni n’existe qu’en image `linux/amd64`. |
| L’API Incus sur une adresse que le bridge de la stack atteint | La CLI et le spawner de sandbox s’y connectent (`runtime.incus.endpoint`, par défaut la passerelle du bridge sur le port 8443), par exemple après `incus config set core.https_address <passerelle>:8443`. Son certificat serveur doit pouvoir être épinglé : sa propre ancre de confiance (`CA:TRUE`), qui nomme l’adresse du point de terminaison. |
| L’accès de l’hôte aux registres d’images | Incus tire chaque image par son digest depuis `ghcr.io` et Docker Hub, ou depuis les miroirs que la déclaration nomme. |
| Root ou membre de `incus-admin`, une fois | Seul `tale incus bootstrap` utilise le socket d’administration local. Chaque commande suivante utilise le certificat restreint. |

Ni l’hôte ni la machine qui prépare le bundle n’ont besoin de Docker. Si Docker tourne quand même sur le même hôte, lis [Partager un hôte avec Docker](#docker-coexistence).

## Déclarer le runtime {#declare}

La spécification de déploiement nomme le runtime dans `runtime.engine` et décrit le nœud dans `runtime.incus`. Les champs sont ceux d’un workspace et figurent dans [Déclarer le runtime de conteneurs](/fr/self-hosted/install/cli-install#container-runtime) ; [Déclarer le runtime Incus](/fr/self-hosted/install/cli-install#managed-incus-runtime) ajoute ce qu’exige un déploiement géré. Un déploiement géré remplace chaque service sur place et n’a pas de couleurs bleue et verte : son bloc d’adresses `block` est donc un /25 dans le sous-réseau du bridge.

```json
{
  "schemaVersion": 1,
  "name": "example-incus",
  "stateDirectory": "/opt/tale-example",
  "composeProject": "tale-example",
  "runtime": {
    "revision": { "env": "TALE_RUNTIME_REF" },
    "platform": "linux/amd64",
    "engine": "incus",
    "incus": {
      "endpoint": "https://10.30.0.1:8443",
      "project": "tale-example",
      "pool": "tank",
      "network": {
        "name": "tale-example",
        "subnet": "10.30.0.0/22",
        "gateway": "10.30.0.1",
        "block": "10.30.1.0/25"
      },
      "sessions": { "subnet": "10.31.0.0/24" },
      "ingress": { "mode": "proxy-device" },
      "volumes": { "db-data": { "size": "100GiB" } }
    }
  },
  "sandbox": { "backend": "incus" },
  "environment": {
    "SANDBOX_INCUS_PROJECT": { "env": "TALE_SANDBOX_INCUS_PROJECT" },
    "SANDBOX_INCUS_PROFILE": { "env": "TALE_SANDBOX_INCUS_PROFILE" },
    "SANDBOX_INCUS_NETWORK": { "env": "TALE_SANDBOX_INCUS_NETWORK" },
    "SANDBOX_INCUS_STORAGE_POOL": { "env": "TALE_SANDBOX_INCUS_STORAGE_POOL" }
  }
}
```

L’exemple omet `origin`, `tlsMode`, `identity` et `configs`, qui restent les mêmes que sous Docker. `sandbox` est requis sous la forme `{ "backend": "incus" }` : le spawner de sandbox est l’une des instances de la stack. Les quatre valeurs `SANDBOX_INCUS_*` nomment le projet, le profil, le bridge et le pool des sessions. Le bootstrap leur donne `<project>-sessions`, `sandbox`, les 13 premiers caractères du nom du bridge suivis de `-s`, et le pool de la stack. Le spawner refuse de démarrer sans elles, et rien ne refuse leur absence avant que le déploiement ne l’atteigne : déclare donc les quatre. [La sandbox sous chaque runtime](/fr/self-hosted/install/cli-install#managed-incus-sandbox) liste ce que la CLI règle elle-même.

## Préparer le nœud {#node-contract}

Le contrat de nœud décrit ce que le serveur Incus doit contenir avant que la stack puisse tourner : le projet avec ses restrictions et ses limites, le profil de la stack, le bridge, les ACL réseau, le pool et la taille des volumes, les hôtes de registre, le certificat à approuver et les priorités d’arrêt. Trois commandes s’en servent, chacune avec `--spec <fichier> --compose <fichier>`, où `--compose` est le `runtime/compose.yml` du bundle : prépare donc d’abord le bundle.

<Steps>

<Step title="Afficher le contrat">

`tale incus contract` l’affiche en JSON versionné (`schemaVersion` 1, `kind` `tale.incus.node-contract`). La commande ne lit aucun nœud et n’a besoin d’aucun identifiant, si bien que tes propres outils peuvent créer les objets à partir de lui. Une CLI plus récente ne fait qu’ajouter des champs à la version 1.

```bash
tale incus contract --spec "$TALE_DEPLOY_SPEC" \
  --compose "$TALE_DEPLOY_BUNDLE/runtime/compose.yml"
```

</Step>

<Step title="Initialiser un hôte unique">

Sur un hôte que toi seul administres, `tale incus bootstrap` met le contrat en place par le socket local (`/var/lib/incus/unix.socket` ; `--socket` en nomme un autre). Il affiche son plan et demande avant de changer quoi que ce soit (`--yes` saute la question). Il crée le projet de la stack, son profil `tale-stack`, le bridge et son ACL, le projet, le bridge, l’ACL et le profil `sandbox` des sessions, ainsi que deux certificats clients restreints à leur projet : celui de la CLI dans `<stateDirectory>/incus/` et celui du spawner dans `<stateDirectory>/sandbox-incus/`, chacun à côté du `server.crt` épinglé. Une deuxième exécution ne change rien, et `--remove` retire ce que le bootstrap a créé, et rien d’autre. Quand le propre certificat du serveur ne peut pas être épinglé, le bootstrap refuse ; `--replace-server-certificate` en écrit un qui peut l’être, garde l’ancien sous `server.crt.tale-bootstrap` et te demande de redémarrer Incus avant de relancer le bootstrap.

```bash
sudo tale incus bootstrap --spec "$TALE_DEPLOY_SPEC" \
  --compose "$TALE_DEPLOY_BUNDLE/runtime/compose.yml"
```

</Step>

<Step title="Vérifier le nœud">

`tale incus check` relit le nœud avec le certificat restreint de la stack et refuse ce qui s’écarte du contrat, une phrase par constat. Les réglages du bridge, ses ACL et le pare-feu de l’hôte ne sont pas visibles pour ce certificat : `check` les juge donc à leur effet. Une instance auxiliaire sur le bridge de la stack ouvre les connexions que les règles sondées autorisent, et une connexion qui expire est refusée avec sa correction. L’instance auxiliaire utilise l’image `tale-proxy` du projet ou, tant que le projet n’en a pas, l’image que nomme `--probe-image` (par défaut la release de cette CLI) ; `--probe-public` et `--probe-name` choisissent l’adresse et le nom publics qu’elle essaie. Avec `--no-probes`, `check` ne lance aucune instance auxiliaire et refuse. La commande se termine avec `3` tant qu’un refus subsiste.

```bash
tale incus check --spec "$TALE_DEPLOY_SPEC" \
  --compose "$TALE_DEPLOY_BUNDLE/runtime/compose.yml"
```

</Step>

</Steps>

Sur un hôte que d’autres équipes administrent, crée les objets à partir du contrat avec tes propres outils, place toi-même les deux répertoires de certificats et lance `tale incus check` en dernier. Les répertoires contiennent `client.crt`, `client.key` et `server.crt`, fermés au groupe et aux autres (0700 pour le répertoire, 0600 pour chaque fichier).

### Le modèle restreint {#restricted-model}

Le projet de la stack est restreint : il n’admet aucune clé de conteneur privilégiée, imbriquée ou de bas niveau (`raw.lxc` donnerait root sur l’hôte), aucun disque de l’hôte et seulement le bridge et le pool que nomme le contrat, aucune machine virtuelle, et il ne tire que depuis les hôtes de registre que liste le contrat, chacun écrit exactement comme l’URL distante le porte. Les `limits.instances`, `limits.memory` et `limits.processes` du projet sont calculées pour le pic de la stack. Le certificat de la CLI n’atteint que ce projet et ne peut en créer aucun autre ; le certificat du spawner n’atteint que le projet des sessions. Une session ne détient jamais de certificat.

### Les ACL réseau {#network-acls}

Les deux bridges rejettent dans les deux sens ce qu’aucune règle n’autorise : une règle manquante expire au lieu de ressembler à un port fermé. Incus ne traduit pas les adresses entre ses propres bridges, si bien que les règles nomment le vrai sous-réseau des sessions.

| Règle | Ce qu’elle autorise | Comment `check` la juge |
| --- | --- | --- |
| `stack-to-stack`, `stack-from-stack` | Le trafic entre les instances de la stack sur son bridge | Listée : ce trafic franchit une ACL de bridge Incus sans règle, donc `check` n’y attend aucun rejet |
| `names-to-gateway-udp`, `names-to-gateway-tcp` | Le résolveur de la stack transmet chaque nom qu’il ne connaît pas au DNS du bridge sur le port 53 | Il passe lui aussi sans règle : `check` demande un nom public et juge la réponse |
| `spawner-to-incus` | Le spawner atteint l’API Incus à `runtime.incus.endpoint` | Sondée |
| `spawner-to-sessions` | Le spawner appelle le runner de chaque session sur le port 8200 | Sondée |
| `public-egress` | Le backend, la plateforme, le proxy egress des sessions, la passerelle de modèles, le proxy (pour ACME) et le fournisseur bgutil atteignent Internet | Sondée |
| `operator-reach-1`, … | Chaque destination que la déclaration nomme dans `runtime.incus.operatorReach`, comme un routeur d’inférence | Sondée en TCP, listée en UDP |
| `public-to-proxy` | Le public atteint le proxy par l’entrée choisie | Listée |
| `sessions-to-*`, `stack-from-sessions-*`, `sessions-from-spawner` | Une session atteint l’API backend par le switch, la passerelle de modèles, le proxy egress et son résolveur, et rien d’autre ; le spawner atteint les sessions | Listées : le côté de la stack ne peut pas émettre de trafic depuis les sessions |

## Choisir l’entrée {#ingress}

`runtime.incus.ingress.mode`, que la spécification doit nommer, décide comment le public atteint l’instance `proxy` de la stack.

| Mode | Ce qui se passe | Quand l’utiliser |
| --- | --- | --- |
| `proxy-device` | Incus publie les ports 80 et 443 sur l’hôte par des périphériques proxy NAT, qui gardent l’adresse du client, sur `listen` ou sur toutes les adresses. | L’hôte est exposé au public, ou un répartiteur de charge transmet vers lui. |
| `routed` | Rien n’est publié. Ta propre redirection ou ton reverse proxy atteint l’instance `proxy` à son adresse sur le bridge. | Un autre edge reçoit déjà le trafic de l’hôte, en général avec `tlsMode: "external"`. |

TLS fonctionne comme sous Docker : le proxy obtient ses certificats en mode `selfsigned` et `letsencrypt`, et `external` laisse TLS à l’edge placé devant. Les réglages de [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains) s’appliquent sans changement.

## Dimensionner le nœud {#sizing}

Chaque instance porte `limits.memory` et `limits.processes` : sa valeur Compose, sinon la valeur de la CLI pour le service, sinon la valeur par défaut du profil `tale-stack`, `2GiB` et 2048 processus.

| Service | Mémoire | Processus |
| --- | --- | --- |
| `backend-api`, `backend-worker` (par réplique) | 12 Gio | 4096 |
| `db`, `knowledge-db` | 8 Gio | 4096 |
| `platform` (par réplique) | 4 Gio | défaut du profil |
| `proxy`, `switch` | 1 Gio | défaut du profil |
| `bgutil-provider` | 512 Mio | 512 |
| `names`, `names-sessions` | 256 Mio | 256 |
| Tout autre service | défaut du profil | défaut du profil |

Ce sont des plafonds, pas des réservations. Le contrat les additionne pour le pic de la stack : chaque instance une fois, puisqu’un déploiement géré remplace sur place, plus deux instances auxiliaires (une tâche ponctuelle et la sonde de `check`). Le disque racine de chaque instance mesure `runtime.incus.rootSize` (`10GiB` par défaut). Déclare une `size` pour chaque volume de données dans `runtime.incus.volumes` : ce n’est que lorsque chaque volume en a une que le contrat limite aussi l’usage du pool par le projet (`limits.disk.pool.<pool>`). Les sessions se dimensionnent à part, avec `SANDBOX_MAX_SESSIONS` et les limites de session de la [référence de l’environnement](/fr/self-hosted/configuration/environment-reference#sandbox-infrastructure) ; garde de la place sur l’hôte pour les deux.

## Déployer {#deploy}

Prépare, vérifie et applique le bundle comme dans [Préparer, vérifier et appliquer le bundle](/fr/self-hosted/install/cli-install#preparer-verifier-et-appliquer-le-bundle). Sur Incus, `deploy prepare` lit chaque image depuis son registre et n’a besoin d’aucun démon Docker. `deploy --bundle` vérifie le nœud par rapport au contrat, compile à nouveau la stack depuis le `.env` du déploiement et refuse celle qui diffère de la stack préparée, puis planifie, applique et relit chaque instance. Revois le plan avant la première application :

```bash
tale --json deploy --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" --plan-only > plan.json

tale --json --yes deploy --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" --plan plan.json
```

`--plan` n’applique le plan revu que tant que le nœud a encore besoin exactement de lui, et `--stop` accepte l’interruption qu’un plan nomme. Les instances portent le nom de leur service (`db`, `proxy`, `switch`), avec un numéro de réplique pour les rôles applicatifs (`platform-1`, `backend-api-1`, `backend-worker-1`).

Un rôle qui tourne avec une seule réplique connaît une coupure à chaque remplacement : de l’arrêt de l’ancienne instance jusqu’à l’admission de la nouvelle, le switch n’a aucune réplique vers laquelle envoyer, et l’edge sert sa page de maintenance, comme lors de la recréation par Docker Compose. Le plan nomme cette fenêtre pour chaque rôle qu’il remplace avec une seule réplique.

## Lire les logs et les plantages {#logs}

Incus garde la sortie console de chaque instance et ne remet chaque ligne qu’une fois : une lecture prend les lignes qu’elle affiche, si bien qu’une lecture ultérieure de l’instance en marche ne les a plus. Lis un service avec le client Incus en tant qu’administrateur, par exemple `incus console db --show-log --project tale-example`, et seulement quand tu en as besoin. Ce que la console contient encore après de nombreuses lectures, ou après une longue exécution, n’est pas mesuré : ne compte pas dessus pour une exécution entière, et envoie les logs ailleurs si tu dois les conserver.

Incus redémarre une instance qui s’arrête de façon inattendue jusqu’à dix fois en une minute, puis la laisse arrêtée, là où Docker continue d’essayer. `incus list --project <projet>` montre une telle instance comme arrêtée. Sa console contient encore les lignes qu’aucune lecture n’a prises ; redémarre-la avec `incus start <instance> --project <projet>` une fois la cause corrigée.

## Prévoir l’arrêt de l’hôte {#host-shutdown}

Quand l’hôte s’arrête, Incus arrête un groupe `boot.stop.priority` après l’autre et donne à chacun jusqu’à 30 secondes. Tale utilise trois groupes :

| Priorité | Services | Arrêtés |
| --- | --- | --- |
| 90 | `proxy`, `switch`, `platform`, `backend-api`, `backend-worker` | En premier |
| 50 | `sandbox`, `sandbox-egress`, `sandbox-llm-gateway`, `bgutil-provider` | En deuxième |
| 10 | `db`, `knowledge-db`, `object-store`, `names`, `names-sessions` | En dernier |

Sur un hôte qui ne fait tourner que Tale, les bases de données reçoivent leur signal d’arrêt en 60 secondes environ. Les priorités 10 à 90 forment la plage réservée de Tale : toute autre instance de l’hôte qui s’arrête dans cette plage ajoute jusqu’à 30 secondes par groupe, et les bases de données peuvent être tuées avant leur signal. Le bootstrap avertit quand un autre projet utilise une priorité de cette plage. La limite de 30 secondes écourte aussi la vidange d’un worker (`SHUTDOWN_DRAIN_MS`, 90 secondes par défaut).

Sur un hôte partagé, ou chaque fois que les workers doivent terminer leur vidange, arrête toi-même la stack avant l’arrêt de l’hôte, groupe par groupe comme dans le tableau et avec un délai supérieur au délai de grâce des services, par exemple `incus stop proxy switch platform-1 backend-api-1 backend-worker-1 --project tale-example --timeout 150`, puis le groupe du milieu, puis le groupe des données. Au démarrage de l’hôte, Incus rétablit le dernier état de chaque instance, donc les instances arrêtées à la main restent arrêtées : redémarre-les toi-même, d’abord la priorité 10, puis 50, puis 90.

## Partager un hôte avec Docker {#docker-coexistence}

Quand Docker tourne sur le même hôte, sa politique `FORWARD` rejette le trafic des bridges Incus. `tale incus check` le montre par des sondes qui expirent. Le bootstrap lit la politique et propose des règles `DOCKER-USER` qui acceptent les deux bridges. Il demande toujours avant de les ajouter, et sans terminal il les affiche pour que tu les exécutes toi-même. Elles tiennent jusqu’au redémarrage de l’hôte, sauf si ta configuration de pare-feu les conserve ; `"ip-forward-no-drop": true` dans `/etc/docker/daemon.json` est la correction durable après un redémarrage. Avec l’entrée `proxy-device`, Docker ne doit pas publier lui aussi les ports 80 et 443.

## Connaître les limites actuelles {#limits}

- Un déploiement existant modifié est refusé : une mise à niveau exige un snapshot de reprise, que la CLI ne peut pas encore prendre sur Incus. Les sauvegardes et restaurations d’un déploiement sur Incus ne sont pas encore disponibles non plus.
- `observe` s’arrête à son inventaire du système de fichiers, et `accept` n’a pas d’origine privée à joindre sur Incus.
- Un client natif géré est créé au premier déploiement, mais l’appel signale un échec, et le déploiement suivant refuse le client.
- Il n’existe encore ni `tale stop` ni `tale start` pour Incus, ni `tale logs` pour un déploiement géré.
- Une stack tourne sur un seul serveur Incus ; les clusters Incus sont refusés.

## Périmètre vérifié {#verified-scope}

Les suites de bout en bout de la CLI pour Incus exécutent la CLI compilée, construite à partir de la modification, contre un vrai nœud Incus 7.6 avec un pool ZFS, l’entrée `routed` et `tlsMode: "external"`, avec les images de la stack construites depuis le même checkout : le bootstrap, un deuxième bootstrap qui ne change rien et la vérification avec ses sondes ; `deploy prepare` sans Docker, le plan du premier déploiement et le déploiement lui-même, la stack répondant par son edge ; un plan vide et un deuxième déploiement qui ne change rien ; le refus d’une mise à niveau sans snapshot de reprise ; des logs lus une seule fois, des boucles de plantage signalées avec leur console, un arrêt propre de Postgres et un arrêt du worker qui vide sa file ; une session qui atteint l’API backend et la passerelle de modèles, et rien d’autre ; et aucun secret dans aucune sortie. L’entrée `proxy-device`, les certificats Let’s Encrypt, `accept` et `observe`, la durée de la fenêtre de remplacement, un redémarrage ou un arrêt de l’hôte, un hôte partagé avec Docker ou d’autres projets et plus d’une réplique par rôle ne faisaient pas partie de ces exécutions.
