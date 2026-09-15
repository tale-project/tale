---
title: Construire et maintenir les images Tale
description: Choisis le bon Dockerfile, construis une image locale, teste son comportement et publie des images vérifiées dans ton registre.
---

Construis une image lorsque tu changes les dépendances d’un conteneur, son démarrage ou le code applicatif qu’il contient. Il te faut les sources préparées selon [Environnement de développement](/fr/develop/contributor-setup), un daemon Docker actif et l’accès aux registres d’images et de paquets utilisés par le Dockerfile.

Une construction réussie prouve que l’image peut être assemblée. Lance-la dans un environnement de développement séparé et teste le comportement modifié avant de la déployer.

## Identifier les images

Les Dockerfiles utilisent la racine du dépôt comme contexte de construction. Consulte chacun pour les versions de base et arguments exacts. Le tableau précise le rôle des images.

| Image | Répertoire du Dockerfile | Contenu et rôle |
| --- | --- | --- |
| `tale-platform` | `services/platform/` | Image Debian avec le client web construit et le backend natif. Les étapes de construction utilisent Bun et Node ; les rôles API et worker partagent cette image. |
| `tale-db` | `services/db/` | PostgreSQL et ses extensions de recherche et de vecteurs, sur une base ParadeDB. Les bases applicative et de connaissances utilisent cette image. |
| `tale-proxy` | `services/proxy/` | Configuration Caddy et démarrage du proxy. |
| `tale-sandbox` | `services/sandbox/` | Gestion des sandboxes avec Bun et la CLI Docker. |
| `tale-sandbox-runtime` | `services/sandbox-runtime/` | Environnement Python avec harnesses de programmation, Node, Bun, navigateurs et outils documentaires. |
| `tale-sandbox-egress` | `services/sandbox-egress/` | Proxy de sortie et prise en charge DNS sur Alpine. |
| `tale-sandbox-buildkitd` | `services/sandbox-buildkitd/` | BuildKit avec les réglages réseau et de démarrage de la sandbox. |
| `tale-sandbox-llm-gateway` | `services/sandbox-llm-gateway/` | Passerelle de modèles construite à partir de Bifrost. |

Le stockage objet et le service auxiliaire d’ingestion vidéo utilisent directement des images amont, sans Dockerfile Tale. Les images d’exécution de sandbox et de BuildKit sont lancées à la demande. Construire les seuls services déclarés dans Compose ne les construit pas automatiquement.

## Construire en local

Pour construire le proxy isolément, lance cette commande à la racine du dépôt :

```bash
docker build -f services/proxy/Dockerfile -t tale-proxy:docs-review .
```

Le tag local `docs-review` distingue le résultat d’une version publiée. Attends que la construction réussisse avant de tester l’image ou de la préparer pour sa distribution.

Pour un service disposant d’une définition `build:` dans le fichier Compose du dépôt :

```bash
docker compose build platform
```

Sans nom de service, `docker compose build` sélectionne tous les services dotés d’une définition de construction. La durée dépend du cache, du réseau, de la plateforme cible et de l’image. Une image de navigateur ou d’application n’a pas les mêmes besoins que le proxy.

Le fichier Compose du dépôt utilise `PULL_POLICY=build` par défaut. Les fichiers de production générés récupèrent normalement les images publiées. [Fichiers Compose](/fr/develop/compose-files) décrit le lancement de développement prévu, qui prépare aussi les services et images supplémentaires.

## Choisir où intervenir

Commence par le changement le plus limité qui répond au besoin :

| Besoin | Point de départ |
| --- | --- |
| Routage, TLS ou en-têtes publics | `services/proxy/Caddyfile` et configuration du proxy. Teste ensuite les retours d’authentification et le streaming. |
| Interface, backend ou extraction | Sources sous `services/platform/`, puis construction de l’image et tests concernés. |
| Paquet ou navigateur dans les sessions d’agents | `services/sandbox-runtime/Dockerfile`. Teste l’image dans une nouvelle session. |
| Connexions sortantes de la sandbox | Options d’environnement existantes d’abord ; modèles du proxy et code de démarrage seulement si nécessaire. |
| Comportement de BuildKit | `services/sandbox-buildkitd/`, avec ses hypothèses réseau. |

Les points d’entrée, contrôles d’état et chemins internes font partie du contrat d’implémentation. Un fork doit maintenir et tester leurs modifications au fil des versions. Une modification de configuration seule peut ne pas nécessiter d’image ; voir [Exploiter Compose soi-même](/fr/self-hosted/install/own-compose).

## Publier dans ton registre

Après les tests, choisis ton espace de noms et un tag immuable. Cet exemple publie uniquement l’image du proxy construite plus haut, pas toutes les images d’un déploiement. L’authentification au registre et le droit d’y publier sont nécessaires.

```bash
export REGISTRY=registry.internal.example.com/tale
export IMAGE_TAG=reviewed-build-1
docker tag tale-proxy:docs-review "$REGISTRY/tale-proxy:$IMAGE_TAG"
docker push "$REGISTRY/tale-proxy:$IMAGE_TAG"
```

Note l’empreinte, le commit source et la plateforme de construction. Distribue toutes les images nécessaires à la destination, dont celles des sandboxes et les dépendances amont. Un environnement hors ligne doit aussi prévoir paquets, téléchargements de navigateurs et accès aux modèles. Transférer une seule image ne rend pas le système autonome.

La CLI lit l’espace de noms des images Tale dans `GHCR_REGISTRY`. La version sélectionnée détermine toujours le tag. Publie donc les noms et tags attendus par le déploiement. Pour fixer séparément les images et commits source, consulte la [référence des déploiements gérés](/fr/self-hosted/install/cli-install#managed-deployments).

## Suivre les évolutions amont

Versionne tes changements et examine les évolutions amont avant de reconstruire. Conserve les versions ou empreintes des images de base avec le compte rendu de construction. Mets ces références à jour délibérément : reconstruire avec une référence inchangée ne récupère pas automatiquement une nouvelle version.

Avant le déploiement, vérifie rôle de démarrage, contrôles d’état, routes publiques et fonctionnalité modifiée. Pour une sandbox, teste une nouvelle session et ses appels réseau. Propose les correctifs d’intérêt général au projet amont lorsque possible pour réduire le code propre à ton fork.

## Diagnostiquer un échec

| Symptôme | Vérification suivante |
| --- | --- |
| Une source de `COPY` manque | Lance la construction depuis la racine avec le contexte prévu ; vérifie `.dockerignore` et le chemin source. |
| Le téléchargement d’un paquet ou d’une image échoue | Vérifie l’accès au registre, l’authentification et la première étape en échec. |
| L’image construite s’arrête au démarrage | Lis les journaux du conteneur et contrôle environnement, montages et rôle. |
| Une sandbox utilise encore d’anciens paquets | Vérifie l’image d’exécution configurée et crée une nouvelle session. Changer un tag ne remplace pas un conteneur existant. |

L’[architecture des conteneurs](/fr/self-hosted/operate/container-architecture) explique les dépendances ; [Mises à jour](/fr/self-hosted/operate/upgrades) couvre le déploiement et la restauration.
