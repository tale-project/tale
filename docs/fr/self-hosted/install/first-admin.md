---
title: Créer le premier admin
description: Initialiser le premier compte sur une instance auto-hébergée toute neuve — obtenir la clé admin, s'inscrire, promouvoir Owner, fermer optionnellement les inscriptions.
---

Une instance Tale toute neuve n'a pas encore d'utilisateurs. La première inscription a besoin d'une clé de bootstrap pour revendiquer le rôle **Owner** ; après ça, l'instance se comporte comme n'importe quelle autre organisation. Ce parcours déroule le bootstrap et pointe vers les réglages qui désactivent l'inscription ouverte une fois l'équipe à l'intérieur.

La clé de bootstrap est générée par un script qui la lit depuis le conteneur platform en cours d'exécution ; elle tourne à chaque redémarrage de la plateforme. Si tu prends trop de temps entre générer la clé et l'utiliser, génère-en une fraîche — les anciennes ne s'empilent pas.

## Avant de commencer

Aie l'instance qui tourne et joignable sur `SITE_URL`. Vérifie avec :

```bash
docker compose ps
```

Chaque service devrait montrer `running` ou `healthy`. Si l'un est unhealthy, le [dépannage](/fr/self-hosted/operate/observability/troubleshooting) nomme les quatre causes courantes.

## Étape 1 — Lancer get-admin-key.sh

Depuis la racine du dépôt :

```bash
./scripts/get-admin-key.sh
```

Le script imprime une clé à usage unique sur stdout. Copie-la — le script ne l'enregistre nulle part.

## Étape 2 — S'inscrire via SITE_URL

Ouvre `SITE_URL` et clique **Sign up**. Remplis tes nom, e-mail et mot de passe. L'écran suivant demande la clé admin — colle-la et soumets. Crée un nom d'**Organisation** sur l'écran d'après. Tu atterris dans le dashboard.

## Étape 3 — Se promouvoir Owner

Sur une instance neuve, le premier compte est automatiquement **Owner** ; aucune promotion manuelle n'est nécessaire. Confirme sous **Paramètres > Personnes** que ta ligne porte le badge Owner.

Si tu as rejoint une instance existante en utilisant la clé admin (ce qui est inhabituel mais pris en charge), ton rôle lira **Admin** à la place, et l'Owner existant peut te promouvoir sur le même écran.

## Étape 4 — Désactiver l'inscription ouverte

Par défaut, la page d'inscription est joignable à `SITE_URL/signup` sans clé de bootstrap une fois qu'un Owner existe. Pour la fermer :

- Ouvre **Paramètres > Organisation** et désactive **Open signup**.
- Ou règle `ALLOW_OPEN_SIGNUP=false` dans `.env` et redémarre le conteneur platform.

Avec l'inscription ouverte désactivée, les nouveaux comptes ne rejoignent que par invitation de membre sous **Paramètres > Personnes** — voir [Membres et rôles](/fr/platform/admin/members-and-roles).

## Dépannage

- **`get-admin-key.sh` échoue avec « container not running ».** Le conteneur platform n'est pas encore monté. `docker compose ps` dira quel service échoue ; les logs via `docker compose logs platform` montrent pourquoi.
- **La clé collée est rejetée.** Les clés tournent par démarrage de conteneur platform. Relance le script pour en obtenir une fraîche.
- **Tu t'es inscrit mais le dashboard lit « no organization ».** L'écran de création d'organisation a été sauté — déconnecte-toi puis reconnecte-toi pour atterrir à nouveau sur le flux de création d'organisation.

## Où ça s'utilise

Tu as maintenant un Owner et une organisation. Les étapes suivantes pour le calendrier sont d'inviter le reste des admins (sous **Paramètres > Personnes**), d'ajouter un fournisseur de modèles, et de publier le premier agent — le parcours [Onboarding Cloud](/fr/cloud/onboarding) est identique à partir d'ici, à l'URL près.
