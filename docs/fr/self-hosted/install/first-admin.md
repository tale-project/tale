---
title: Créer le premier admin
description: Faire passer une instance auto-hébergée toute neuve par son assistant de configuration unique — le premier compte devient Owner sans clé, les nouveaux arrivent par invitation, et la clé admin ne sert qu'au tableau de bord Convex.
---

Une instance Tale toute neuve n'a pas encore d'utilisateurs. La première personne qui l'ouvre déroule un assistant de configuration unique qui crée son compte, la connecte, en fait l'**Owner** et nomme la première organisation — aucune clé de bootstrap, aucune promotion manuelle. Ce parcours couvre ce premier lancement, comment les coéquipiers arrivent ensuite, et où obtenir la clé admin du tableau de bord Convex si tu dois un jour inspecter le backend directement.

La seule chose à désapprendre des anciennes instructions : la première inscription ne demande plus de clé admin. Tale est sur invitation seulement après le premier compte, donc il n'y a pas non plus de page d'inscription ouverte à verrouiller.

## Avant de commencer

Aie l'instance qui tourne et joignable sur `SITE_URL`. Vérifie avec :

```bash
docker compose ps
```

Chaque service devrait montrer `running` ou `healthy`. Si l'un est unhealthy, le [dépannage](/fr/self-hosted/operate/observability/troubleshooting) nomme les quatre causes courantes.

## Dérouler l'assistant de configuration

Ouvre `SITE_URL`. Comme il n'y a pas encore d'utilisateurs, Tale t'envoie directement dans l'assistant de configuration — il n'y a pas de page d'inscription séparée à chercher, car l'écran de connexion redirige automatiquement une instance vide vers la configuration. L'assistant crée ton compte et te connecte en plein flux, puis nomme ta première organisation.

L'étape du fournisseur est optionnelle : saute-la et ajoute une clé plus tard sous **Paramètres > Fournisseurs IA**, ou connecte OpenRouter maintenant pour discuter tout de suite. Obtiens une clé sur [openrouter.ai/keys](https://openrouter.ai/keys). L'étape finale te dépose dans le tableau de bord.

## Confirmer que tu es l'Owner

Le premier compte sur une instance neuve est automatiquement l'**Owner** — aucune clé à coller, aucune étape de promotion. Confirme sous **Paramètres > Personnes** que ta ligne porte le badge Owner.

## Comment les nouvelles personnes arrivent

Il n'y a pas d'inscription en libre-service. Une fois qu'un Owner existe, `SITE_URL/sign-up` redirige les visiteurs vers l'écran de connexion, donc personne ne peut créer un compte de lui-même. Ajoute les coéquipiers par invitation sous **Paramètres > Personnes** ; chaque invitation porte le rôle avec lequel le nouveau membre démarre. Le modèle de rôles complet est dans [Membres et rôles](/fr/platform/admin/members-and-roles).

## Obtenir la clé admin du tableau de bord Convex

La clé admin ne joue aucun rôle dans les étapes ci-dessus — elle ne débloque que le **tableau de bord Convex**, la vue bas niveau de la base de données du backend. La clé est déterministe : elle est dérivée de `INSTANCE_SECRET`, donc elle reste la même d'un redémarrage à l'autre au lieu de tourner.

Obtiens-la de la façon qui correspond à ton installation :

- Avec la CLI : `tale convex admin` trouve le conteneur platform et imprime la clé. `tale dev` l'imprime aussi une fois les services en bonne santé.
- Depuis un clone git : `./scripts/get-admin-key.sh` à la racine du dépôt.

Ouvre `SITE_URL/convex-dashboard`, saisis `SITE_URL` comme URL de déploiement, et colle la clé quand on te la demande.

## Dépannage

- **L'assistant n'est pas apparu — tu atterris sur l'écran de connexion.** Des utilisateurs existent déjà sur cette instance ; l'assistant ne tourne que sur une instance vraiment vide. Connecte-toi à la place, ou fais-toi inviter par un Owner existant sous **Paramètres > Personnes**.
- **Un service est unhealthy.** Le conteneur platform n'est pas entièrement monté. `docker compose ps` dit quel service échoue ; `docker compose logs platform` montre pourquoi.
- **Le tableau de bord rejette la clé admin.** La clé est déterministe à partir de `INSTANCE_SECRET`, donc un rejet signifie généralement que `INSTANCE_NAME` et `INSTANCE_SECRET` diffèrent entre les services platform et Convex, ou que l'URL de déploiement est fausse — utilise `SITE_URL`. Régénère avec `tale convex admin` pour être sûr d'avoir copié la valeur actuelle.

## Où ça s'utilise

Tu as maintenant un Owner et une organisation, et tu sais que la clé admin est un outil d'inspection du backend, pas une partie de la connexion. Le premier lancement est sans clé par conception : ouvre l'URL, l'assistant te fait Owner, et tous les autres arrivent par invitation.

Les étapes suivantes pour le calendrier sont d'inviter le reste des admins (sous **Paramètres > Personnes**), d'ajouter un fournisseur de modèles, et de publier le premier agent — le parcours [Onboarding Cloud](/fr/cloud/onboarding) est identique à partir d'ici, à l'URL près.
