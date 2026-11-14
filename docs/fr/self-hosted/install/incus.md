---
title: Exécuter Tale sur Incus
description: Exécute un workspace Tale ou un déploiement géré sous forme d’instances Incus plutôt que de conteneurs Docker Compose, du contrat de nœud et de sa vérification jusqu’au déménagement d’un déploiement existant et aux limites à prévoir.
---

Un workspace que tu déploies avec `tale deploy`, ou un déploiement géré, peut tourner sur [Incus](https://linuxcontainers.org/incus/) au lieu de Docker Compose : chaque service de la stack devient une instance Incus dans un projet restreint d’un hôte Linux, et les sessions sandbox tournent à côté, dans un projet à elles. La CLI Tale compile pour cela les mêmes définitions Compose que celles du runtime Docker, si bien que les services, les images et les réglages sont les mêmes. Cette page te mène d’un hôte Incus à un déploiement en marche, y fait passer un déploiement Docker existant et nomme les limites à prévoir.

<Warning>

Le runtime Incus est **expérimental** dans Tale 0.5.x. Docker Compose reste le runtime par défaut et le runtime pris en charge. Un workspace tourne sur Incus avec `tale deploy`, ses mises à niveau blue-green, ses sauvegardes et ses restaurations. Un [déploiement géré](/fr/self-hosted/install/cli-install#managed-deployments) reçoit son premier déploiement sur Incus, mais sa mise à niveau y est encore refusée, car son snapshot de reprise n’est pas encore pris sur Incus.

</Warning>

## Choisir le runtime Incus {#choose-incus}

Choisis Incus quand un hôte fait déjà tourner Incus pour d’autres charges, ou quand tu veux la stack et ses sessions dans des projets Incus restreints, sans démon Docker. La CLI dialogue avec Incus par son API REST, avec un certificat client restreint au projet de la stack, et n’a besoin des droits d’administration de l’hôte que pour le bootstrap initial. Garde Docker Compose quand tu développes en local avec `tale dev`, qui ne tourne que sur Docker, quand tu as besoin d’appareils sandbox connectés, ou quand l’hôte ne remplit pas les prérequis ci-dessous.

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
| La CLI sous Linux ou macOS | La CLI garde les identifiants Incus, la clé de plan et le journal dans des fichiers fermés aux autres comptes, ce que Windows ne permet pas : elle y refuse donc `tale incus check`, `tale incus bootstrap`, les déploiements et les autres commandes de la stack sur Incus. `tale incus contract` fonctionne partout. |

Ni l’hôte, ni la machine du workspace, ni la machine qui prépare un bundle n’ont besoin de Docker. Si Docker tourne quand même sur le même hôte, lis [Partager un hôte avec Docker](#docker-coexistence).

## Déclarer le runtime {#declare}

Le `tale.json` d’un workspace, ou une spécification de déploiement, nomme le runtime dans `runtime.engine` et décrit le nœud dans `runtime.incus`. Les champs figurent dans [Déclarer le runtime de conteneurs](/fr/self-hosted/install/cli-install#container-runtime). Un workspace fait tourner deux couleurs côte à côte pendant une mise à niveau : son bloc d’adresses `block` est donc un /24. Un déploiement géré remplace chaque service sur place et n’a pas de couleurs bleue et verte : son `block` est donc un /25 dans le sous-réseau du bridge.

Pour un nouveau workspace, `tale init` écrit le bloc à partir de ses options :

```bash
tale init my-project --runtime incus \
  --incus-project tale-acme --incus-pool tank \
  --incus-network tale-acme --incus-subnet 10.30.0.0/24 \
  --incus-sessions-subnet 10.31.0.0/24
```

La passerelle vaut par défaut le premier hôte du sous-réseau, le bloc le sous-réseau lui-même quand c’est un /24, et l’entrée `proxy-device`. Ne passe `runtime.engine` à `incus` à la main que dans un workspace qui n’a encore jamais été déployé. Un workspace qui tourne déjà sur Docker déclare le runtime Incus dans `runtime.next` et [déménage](#migrate), pour que ses données suivent. Un déploiement géré le déclare dans sa spécification, avec ce qu’ajoute [Déclarer le runtime Incus](/fr/self-hosted/install/cli-install#managed-incus-runtime) :

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

Le contrat de nœud décrit ce que le serveur Incus doit contenir avant que la stack puisse tourner : le projet avec ses restrictions et ses limites, le profil de la stack, le bridge, les ACL réseau, le pool et la taille des volumes, les hôtes de registre, le certificat à approuver et les priorités d’arrêt. Trois commandes s’en servent. Dans un workspace, elles lisent `tale.json` (`--workspace <dossier>` en nomme un autre que le dossier courant). Pour un déploiement géré, passe `--spec <fichier> --compose <fichier>`, où `--compose` est le `runtime/compose.yml` du bundle : prépare donc d’abord le bundle. Les exemples ci-dessous montrent la forme d’un déploiement géré.

<Steps>

<Step title="Afficher le contrat">

`tale incus contract` l’affiche en JSON versionné (`schemaVersion` 1, `kind` `tale.incus.node-contract`). La commande ne lit aucun nœud et n’a besoin d’aucun identifiant, si bien que tes propres outils peuvent créer les objets à partir de lui. Une CLI plus récente ne fait qu’ajouter des champs à la version 1.

```bash
tale incus contract --spec "$TALE_DEPLOY_SPEC" \
  --compose "$TALE_DEPLOY_BUNDLE/runtime/compose.yml"
```

</Step>

<Step title="Initialiser un hôte unique">

Sur un hôte que toi seul administres, `tale incus bootstrap` met le contrat en place par le socket local (`/var/lib/incus/unix.socket` ; `--socket` en nomme un autre). Il affiche son plan et demande avant de changer quoi que ce soit (`--yes` saute la question). Il crée le projet de la stack, son profil `tale-stack`, le bridge et son ACL, le projet, le bridge, l’ACL et le profil `sandbox` des sessions, ainsi que deux certificats clients restreints à leur projet : celui de la CLI dans `<stateDirectory>/incus/` et celui du spawner dans `<stateDirectory>/sandbox-incus/`, chacun à côté du `server.crt` épinglé. Dans un workspace, ces deux dossiers sont `.tale/incus/` et `.tale/sandbox-incus/`, et un bootstrap lancé en root les confie au propriétaire du workspace. Une deuxième exécution ne change rien, et `--remove` retire ce que le bootstrap a créé, et rien d’autre. Quand le propre certificat du serveur ne peut pas être épinglé, le bootstrap refuse ; `--replace-server-certificate` en écrit un qui peut l’être, garde l’ancien sous `server.crt.tale-bootstrap` et te demande de redémarrer Incus avant de relancer le bootstrap.

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

Ce sont des plafonds, pas des réservations. Le contrat les additionne pour le pic de la stack, plus deux instances auxiliaires (une tâche ponctuelle et la sonde de `check`) : pour un workspace, les services avec état une fois et la couleur applicative deux fois, puisque les deux couleurs tournent pendant une mise à niveau ; pour un déploiement géré, chaque instance une fois, puisqu’il remplace sur place. Après avoir augmenté un nombre de répliques, relance `tale incus bootstrap` : `tale deploy` refuse un projet dont les limites ne suffisent plus, avant de changer quoi que ce soit. Le disque racine de chaque instance mesure `runtime.incus.rootSize` (`10GiB` par défaut). Déclare une `size` pour chaque volume de données dans `runtime.incus.volumes` : ce n’est que lorsque chaque volume en a une que le contrat limite aussi l’usage du pool par le projet (`limits.disk.pool.<pool>`). Les sessions se dimensionnent à part, avec `SANDBOX_MAX_SESSIONS` et les limites de session de la [référence de l’environnement](/fr/self-hosted/configuration/environment-reference#sandbox-infrastructure) ; garde de la place sur l’hôte pour les deux.

## Déployer {#deploy}

Un workspace se déploie avec `tale deploy`, comme sur Docker ; un déploiement géré applique un bundle préparé.

### Déployer un workspace {#deploy-workspace}

Dans un workspace, `tale deploy` fonctionne comme sur Docker, après les vérifications qu’ajoute Incus. Il lit les certificats dans `.tale/incus/` et vérifie le nœud par rapport au contrat de la stack, comme `tale incus check` le fait sans ses sondes. Il amène ensuite la stack à l’état voulu, périmètre par périmètre : les volumes, les résolveurs et le switch de trafic, les services avec état, puis la couleur inactive, dont les répliques reçoivent du trafic dès que le switch les admet. Revois d’abord le plan de chaque périmètre :

```bash
tale --json deploy --plan-only > plan.json
tale deploy --plan plan.json
tale status
```

`--plan` n’applique le plan revu que tant que le nœud a encore besoin exactement de lui. Le premier déploiement crée tout. Les déploiements suivants basculent de couleur comme le décrit [Mises à niveau](/fr/self-hosted/operate/upgrades#incus), et `tale status` montre chaque réplique, si le switch l’admet, et une bascule interrompue. Les instances portent le nom de leur service, avec la couleur et un numéro de réplique pour les rôles applicatifs (`platform-blue-1`).

### Déployer un bundle géré {#deploy-managed}

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

Incus garde la sortie console de chaque instance et ne remet chaque ligne qu’une fois : une lecture prend les lignes qu’elle affiche, si bien qu’une lecture ultérieure de l’instance en marche ne les a plus. Dans un workspace, `tale logs <service>` lit un service arrêté ; pour un service en marche, il faut `--consume`, et la commande prévient d’abord que la lecture prend les lignes. Pour un déploiement géré, lis un service avec le client Incus en tant qu’administrateur, par exemple `incus console db --show-log --project tale-example`, et seulement quand tu en as besoin. Ce que la console contient encore après de nombreuses lectures, ou après une longue exécution, n’est pas mesuré : ne compte pas dessus pour une exécution entière, et envoie les logs ailleurs si tu dois les conserver.

Incus redémarre une instance qui s’arrête de façon inattendue jusqu’à dix fois en une minute, puis la laisse arrêtée, là où Docker continue d’essayer. `tale status` signale un tel service comme `stopped after repeated crashes`, avec les dernières lignes de console qu’Incus a gardées, et `incus list --project <projet>` le montre comme arrêté. Une fois la cause corrigée, redémarre-le avec `tale start` dans un workspace, sinon avec `incus start <instance> --project <projet>`.

## Prévoir l’arrêt de l’hôte {#host-shutdown}

Quand l’hôte s’arrête, Incus arrête un groupe `boot.stop.priority` après l’autre et donne à chacun jusqu’à 30 secondes. Tale utilise trois groupes :

| Priorité | Services | Arrêtés |
| --- | --- | --- |
| 90 | `proxy`, `switch`, `platform`, `backend-api`, `backend-worker` | En premier |
| 50 | `sandbox`, `sandbox-egress`, `sandbox-llm-gateway`, `bgutil-provider` | En deuxième |
| 10 | `db`, `knowledge-db`, `object-store`, `names`, `names-sessions` | En dernier |

Sur un hôte qui ne fait tourner que Tale, les bases de données reçoivent leur signal d’arrêt en 60 secondes environ. Les priorités 10 à 90 forment la plage réservée de Tale : toute autre instance de l’hôte qui s’arrête dans cette plage ajoute jusqu’à 30 secondes par groupe, et les bases de données peuvent être tuées avant leur signal. Le bootstrap avertit quand un autre projet utilise une priorité de cette plage. La limite de 30 secondes écourte aussi la vidange d’un worker (`SHUTDOWN_DRAIN_MS`, 90 secondes par défaut).

Sur un hôte partagé, ou chaque fois que les workers doivent terminer leur vidange, arrête toi-même la stack avant l’arrêt de l’hôte. Dans un workspace, `tale stop` s’en charge groupe par groupe comme dans le tableau, chaque service dans son propre délai de grâce, et `tale start` redémarre les groupes dans l’ordre inverse une fois l’hôte revenu, chacun en bonne santé avant le suivant. Un déploiement géré s’arrête avec le client Incus, groupe par groupe et avec un délai supérieur au délai de grâce des services, par exemple `incus stop proxy switch platform-1 backend-api-1 backend-worker-1 --project tale-example --timeout 150`, puis le groupe du milieu, puis le groupe des données. Au démarrage de l’hôte, Incus rétablit le dernier état de chaque instance, donc les instances arrêtées le restent jusqu’à ce que tu les démarres : avec `tale start`, ou à la main, d’abord la priorité 10, puis 50, puis 90.

## Partager un hôte avec Docker {#docker-coexistence}

Quand Docker tourne sur le même hôte, il règle la politique `FORWARD` de l’hôte sur le rejet, ce qui rejette aussi le trafic des bridges Incus. `tale incus check` ne peut pas lire le pare-feu de l’hôte avec son certificat restreint : il montre donc la perte par des sondes qui expirent, et nomme deux corrections :

- **Des règles `DOCKER-USER`** qui acceptent les deux bridges agissent tout de suite. Le bootstrap lit la politique et les propose. Il demande toujours avant de les ajouter, et sans terminal il les affiche pour que tu les exécutes toi-même. Elles tiennent jusqu’au redémarrage de l’hôte, sauf si ta configuration de pare-feu les conserve.
- **`"ip-forward-no-drop": true`** dans `/etc/docker/daemon.json` empêche Docker de régler la politique sur le rejet, mais seulement après un redémarrage de l’hôte : redémarrer Docker laisse la politique telle quelle.

Ajoute d’abord les règles `DOCKER-USER` et conserve-les dans ta configuration de pare-feu, ou règle `ip-forward-no-drop` pour le prochain redémarrage.

Avec l’entrée `proxy-device`, Docker ne doit pas publier lui aussi les ports 80 et 443. Incus accepte les périphériques proxy même pendant qu’un conteneur Docker publie les mêmes ports, et ils prennent aussitôt le trafic venu de l’extérieur, sans qu’aucun échec ne te prévienne. `tale incus check` ne voit pas Docker non plus ; [`tale runtime migrate`](#migrate) vérifie les ports que Docker publie avant d’ajouter les périphériques proxy.

## Déménager un workspace entre Docker et Incus {#migrate}

`tale runtime migrate` fait passer le déploiement Docker en marche d’un workspace sur Incus, dans la même version et avec le même `.env`, et garde la stack Docker arrêtée pour que tu puisses revenir en arrière. Les utilisateurs subissent une interruption dès que la stack Docker s’arrête et jusqu’à ce que la stack sur Incus soit déployée ; l’essentiel de ce temps passe dans l’archivage et la restauration des données, surtout du stockage d’objets. Prévois une fenêtre de maintenance, et garde une sauvegarde hors de l’hôte comme le décrit [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore).

<Steps>

<Step title="Déclarer la cible">

Laisse `runtime.engine` tel quel et ajoute le runtime Incus en `runtime.next`, avec les mêmes champs qu’un workspace Incus (un /24 comme `block`). Lance le déménagement avec la CLI de la version que le workspace exécute : il déplace une version telle quelle et refuse une CLI qui en déploierait une autre.

```json
{
  "runtime": {
    "next": {
      "engine": "incus",
      "incus": {
        "project": "tale-acme",
        "pool": "tank",
        "network": { "name": "tale-acme", "subnet": "10.30.0.0/24", "gateway": "10.30.0.1", "block": "10.30.0.0/24" },
        "sessions": { "subnet": "10.31.0.0/24" },
        "ingress": { "mode": "proxy-device" }
      }
    }
  }
}
```

</Step>

<Step title="Préparer le nœud">

`tale incus bootstrap`, `check` et `contract` lisent `runtime.next` tant que le workspace tourne encore sur Docker. Sur le même hôte, ajoute les règles `DOCKER-USER` que propose le bootstrap, comme le décrit [Partager un hôte avec Docker](#docker-coexistence), et lance la vérification jusqu’à ce qu’elle passe :

```bash
sudo tale incus bootstrap
tale incus check
```

</Step>

<Step title="Déménager">

```bash
tale runtime migrate --to incus
```

Le déménagement vérifie à nouveau le nœud, avec les sondes de transfert, et refuse sur un hôte où le pare-feu de Docker rejette encore le trafic des bridges. Il vide ensuite le backend et la sandbox, puis arrête chaque conteneur de la stack Docker, proxy compris. Il archive les volumes Docker, exporte le snapshot et l’importe dans le volume `backups` de la stack Incus, en vérifiant chaque archive par SHA-256. Il restaure le snapshot dans des volumes Incus neufs et déploie la même version sur Incus. Avant ce déploiement, il lit les ports de chaque conteneur Docker en marche et refuse tant que l’un d’eux publie encore le port 80 ou 443. Il lance ensuite les smoke checks publics contre le nouvel edge et passe `runtime.engine` à `incus`.

Chaque étape est consignée dans `.tale/migration.json`. Quand une exécution s’arrête, corrige la cause signalée et relance la même commande : elle reprend après la dernière étape terminée. Tant qu’un déménagement est en cours, `tale deploy`, `tale start` et `tale rollback` refusent.

</Step>

<Step title="Accepter ou revenir en arrière">

Connecte-toi, ouvre une conversation connue et télécharge un ancien fichier à l’adresse du site. Les conteneurs Docker restent arrêtés, y compris après un redémarrage de Docker ou de l’hôte : leur politique de redémarrage `unless-stopped` laisse arrêté un conteneur arrêté explicitement. Choisis ensuite :

- `tale runtime migrate --to docker` revient en arrière : il supprime les instances Incus (leurs volumes restent), repasse `runtime.engine` à `docker` et redémarre la stack Docker arrêtée sur les données qu’elle avait. Ce que les utilisateurs ont changé sur Incus depuis le déménagement ne revient pas sur Docker.
- `tale runtime migrate --finish` supprime la stack Docker arrêtée, ses conteneurs et ses volumes de données, et garde son volume `backups`. Il demande d’abord (`--yes` saute la question) ; tu ne peux plus revenir en arrière ensuite.

</Step>

</Steps>

Les smoke checks joignent le nouvel edge à `SITE_URL`. Les périphériques proxy NAT ne prennent aucun trafic que l’hôte envoie à sa propre adresse de loopback : un site sous un nom de loopback (`http://localhost`) est donc vérifié à l’adresse propre de l’edge Incus. Pour déménager vers **un autre hôte**, nomme l’API Incus du nouvel hôte dans `runtime.next.incus.endpoint`, prépare ce nœud comme le décrit [Préparer le nœud](#node-contract), et place les deux dossiers de certificats dans le `.tale/` du workspace. Passe `--smoke-url` avec une adresse qui joint l’edge du nouvel hôte avant que le DNS ne bascule, et change le DNS après le déménagement. Les étapes de pare-feu et de ports propres au même hôte ne s’y appliquent pas.

**Revenir d’Incus à Docker après `--finish`.** Plus rien ne te garde alors de stack Docker : fais passer les données dans un snapshot. Sur Incus, prends un snapshot et exporte-le, puis importe-le et restaure-le dans un workspace Docker qui a le même `.env` et la même version, et déploie cette version. [Déplacer un snapshot vers un autre hôte ou un autre runtime](/fr/self-hosted/operate/backups-and-restore#export-import) décrit les commandes.

## Connaître les limites actuelles {#limits}

- Un déploiement géré modifié est refusé sur Incus : sa mise à niveau exige un snapshot de reprise, que le parcours géré ne peut pas encore prendre sur Incus. Un workspace prend son snapshot natif avant chaque mise à niveau.
- `observe` s’arrête à son inventaire du système de fichiers, et `accept` n’a pas d’origine privée à joindre sur Incus.
- Un client natif géré est créé au premier déploiement, mais l’appel signale un échec, et le déploiement suivant refuse le client.
- `tale stop`, `tale start` et `tale logs` fonctionnent dans un workspace ; un déploiement géré n’en a aucun sur Incus.
- Une stack tourne sur un seul serveur Incus ; les clusters Incus sont refusés.
- `tale dev` et les appareils sandbox connectés ne tournent que sur Docker.

## Périmètre vérifié {#verified-scope}

Les suites de bout en bout de la CLI pour Incus exécutent la CLI compilée, construite à partir de la modification, contre un vrai nœud Incus 7.6 avec un pool ZFS, l’entrée `routed` et `tlsMode: "external"`, avec les images de la stack construites depuis le même checkout.

Pour un déploiement géré, elles couvrent le bootstrap, un deuxième bootstrap qui ne change rien et la vérification avec ses sondes ; `deploy prepare` sans Docker, le plan du premier déploiement et le déploiement lui-même, la stack répondant par son edge ; un plan vide et un deuxième déploiement qui ne change rien ; le refus d’une mise à niveau sans snapshot de reprise ; des logs lus une seule fois, des boucles de plantage signalées avec leur console, un arrêt propre de Postgres et un arrêt du worker qui vide sa file ; une session qui atteint l’API backend et la passerelle de modèles, et rien d’autre ; et aucun secret dans aucune sortie.

Pour un workspace avec deux répliques de `platform` et de `backend-api`, elles couvrent 20 bascules de couleur entre deux releases sous un trafic continu passant par l’edge, sans aucune requête en échec ; des flux d’événements ouverts qui le restent pendant le retrait et se reconnectent à la nouvelle couleur ; un switch et des résolveurs de l’ancienne release qui continuent de tourner jusqu’à ce que `--stop` les remplace ; un remplacement progressif avec `--services` et un rollback ; une bascule interrompue que le déploiement suivant termine ; un snapshot natif, son archive, un export et un import, une restauration et son historique ; une restauration interrompue à chaque étape, refusée par `tale deploy` et `tale start` jusqu’à ce que `--resume` ou `--abort` la termine ; un `reset --all` qui garde les snapshots ; et une réplique redémarrée pendant qu’elle est retirée.

Un déménagement depuis Docker sur le même hôte a été mené sur un hôte de laboratoire avec Docker 29 à côté d’Incus 7.6 et l’entrée `proxy-device`, avec son retour en arrière, un deuxième déménagement et `--finish`. L’entrée `proxy-device` dans les suites, les certificats Let’s Encrypt, `accept` et `observe`, la durée de la fenêtre de remplacement d’un déploiement géré, un redémarrage ou un arrêt de l’hôte, un redémarrage de Docker après un déménagement, un déménagement vers un autre hôte et un hôte partagé avec d’autres projets ne faisaient pas partie de ces exécutions.
