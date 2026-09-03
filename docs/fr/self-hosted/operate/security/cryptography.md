---
title: Cryptographie
description: Les algorithmes que Tale utilise pour les données au repos, les données en transit, le hachage des mots de passe et l'intégrité du journal d'audit — et leur correspondance avec BSI TR-02102-1.
---

Cette page est l'inventaire de chaque primitive cryptographique sur laquelle Tale s'appuie : ce qui protège les secrets sur le disque, ce qui protège le trafic sur le réseau, comment les mots de passe sont hachés, et comment le journal d'audit prouve qu'il n'a pas été altéré. Elle est écrite pour les opérateurs et les auditeurs de conformité qui doivent répondre à « quels algorithmes, quelles longueurs de clé, où sont les clés » face à une norme comme BSI TR-02102-1 — Tale utilise déjà des primitives conformes, et cette page est l'endroit où elles sont consignées.

Les affirmations ici sont vérifiées contre le code source ; là où une primitive est configurable, la variable d'environnement qui la contrôle est nommée pour que tu puisses auditer ton propre déploiement. Ce n'est pas un substitut au chiffrement du disque hôte — vois [Durcissement](/fr/self-hosted/operate/security/hardening) pour la couche sous l'application.

## Données au repos

Tale chiffre deux classes de secrets au repos, avec deux mécanismes différents.

**Les clés API des fournisseurs** vivent dans `providers/*.secrets.json` et sont chiffrées avec [SOPS](/fr/self-hosted/configuration/secrets-with-sops) en utilisant une clé **age**. SOPS chiffre chaque valeur avec **AES-256-GCM** et enveloppe la clé de données vers le destinataire age, dont l'échange de clés est **X25519**. Une valeur chiffrée se lit `ENC[AES256_GCM,data:…,iv:…,tag:…]` sur le disque ; le déchiffrement se fait in-process et la clé privée age ne quitte jamais la mémoire du conteneur platform.

**Les champs chiffrés par l'application** — tokens de connector OAuth et identifiants similaires stockés en base — sont chiffrés avec **AES-256-GCM** via un JWE compact (`alg: dir`, `enc: A256GCM`). La clé de 32 octets vient de `ENCRYPTION_SECRET` (base64) ou `ENCRYPTION_SECRET_HEX` (hex) ; la plateforme refuse de démarrer le chemin de chiffrement avec une clé qui ne fait pas exactement 32 octets.

Les volumes Postgres et le store de blobs sont protégés par l'hôte : fais-les tourner sur un système de fichiers chiffré (LUKS, ou le chiffrement de volume de ton fournisseur cloud). Tale ne stocke pas d'identifiants en clair — une clé de fournisseur ou un token OAuth est soit chiffré par SOPS sur le disque, soit chiffré en AES-256-GCM en base, jamais écrit en clair.

**Les données personnelles des clients et les enregistrements applicatifs** — noms, adresses e-mail et postales, contenu des conversations — sont protégés au repos par les mêmes couches qui protègent la base dans son ensemble : le chiffrement du système de fichiers de l'hôte (ci-dessus), TLS 1.3 en transit, et un contrôle d'accès restreint à l'organisation qui limite chaque lecture à l'organisation de l'appelant.

Le chiffrement applicatif au niveau des champs est conçu pour les secrets — clés de fournisseur et tokens OAuth, écrits une fois et lus par un unique chemin de code. Les données personnelles sont différentes : elles sont filtrées, triées et recherchées par valeur exacte, et la table des clients est indexée par organisation et e-mail. Chiffrer ces colonnes au niveau des champs casserait les recherches par égalité et l'indexation — sauf à les coupler à un schéma de hachage recherchable qui révèle l'égalité même qu'il est censé masquer — au prix d'une rotation des clés et sans protection que le système de fichiers hôte chiffré sous l'application n'offre déjà contre un volume volé.

Si ta réglementation de conformité exige en plus un chiffrement des données personnelles au niveau des champs, c'est une modification applicative délibérée plutôt qu'un défaut livré par Tale.

## Données en transit

Tout le trafic navigateur et API termine TLS au reverse proxy (Caddy), qui négocie TLS 1.3 (avec TLS 1.2 comme plancher) et obtient les certificats automatiquement. Les suites de chiffrement sont les défauts modernes du proxy — AES-256-GCM et ChaCha20-Poly1305 avec échange de clés ECDHE. Configure le domaine et la source de certificat dans [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains) ; le trafic entre conteneurs reste sur le réseau Docker interne de l'hôte.

## Hachage des mots de passe

Les comptes à mot de passe local sont hachés avec **bcrypt** (via Better Auth), de sorte qu'une ligne de base de données volée ne révèle pas le mot de passe et qu'une vérification coûte délibérément ~100 ms — ce qui explique aussi pourquoi le timing du chemin de connexion est brouillé (vois [Authentification](/fr/self-hosted/configuration/authentication)). Les sessions sont signées avec `BETTER_AUTH_SECRET` (HMAC) ; faire tourner ce secret invalide toute session existante.

## Intégrité du journal d'audit

Le journal d'audit est inviolable grâce à une **chaîne de hachage SHA-256** : chaque entrée stocke `SHA-256(previousHash + enregistrement canonisé)`, donc modifier ou supprimer une entrée historique casse la chaîne à cet endroit et à chaque entrée suivante. Les entrées portent en plus une signature **HMAC-SHA-256**. La vérification d'intégrité admin vérifie les deux ; vois [Journaux d'audit](/fr/platform/admin/governance/audit-logs).

## Correspondance avec BSI TR-02102-1

Chaque primitive ci-dessous est dans l'ensemble recommandé de BSI TR-02102-1. Tale ne livre aucun algorithme déprécié (pas de MD5, SHA-1, DES ni RSA &lt; 3072 sur une clé qu'il génère).

| Usage                         | Algorithme                        | Taille de clé / sortie | Contrôlé par                                  |
| ----------------------------- | --------------------------------- | ---------------------- | --------------------------------------------- |
| Secrets fournisseurs (disque) | AES-256-GCM + age (X25519)        | 256 bits               | `SOPS_AGE_KEY` / `SOPS_AGE_KEY_FILE`          |
| Champs app (base de données)  | AES-256-GCM (JWE `dir`/`A256GCM`) | 256 bits               | `ENCRYPTION_SECRET` / `ENCRYPTION_SECRET_HEX` |
| Transport                     | TLS 1.3 (AES-256-GCM, ECDHE)      | 256 bits               | Reverse proxy / `tls-and-domains`             |
| Hachage des mots de passe     | bcrypt                            | sel par hachage        | Better Auth (intégré)                         |
| Signature de session          | HMAC-SHA-256                      | 256 bits               | `BETTER_AUTH_SECRET`                          |
| Intégrité d'audit             | chaîne SHA-256 + HMAC-SHA-256     | 256 bits               | intégré                                       |

## Stockage et rotation des clés

Trois secrets sont porteurs, et chacun a un chemin de rotation. La **clé privée age** (`SOPS_AGE_KEY`) déchiffre les secrets fournisseurs ; fais-la tourner en ajoutant un nouveau destinataire et en re-chiffrant, en suivant le parcours dans [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops). La **clé de chiffrement de champ** (`ENCRYPTION_SECRET`) déchiffre les identifiants en base ; la faire tourner exige de re-chiffrer les lignes concernées, planifie-la donc comme une étape de maintenance plutôt qu'un échange à chaud. Le **secret d'auth** (`BETTER_AUTH_SECRET`) signe les sessions ; le faire tourner déconnecte tout le monde à la requête suivante. Les trois ne vivent que dans l'environnement du conteneur platform — ne les committe jamais et range-les dans ton gestionnaire de secrets de référence.

## Où cela s'inscrit

La cryptographie dans Tale est en couches : SOPS+age et AES-256-GCM protègent les secrets au repos, TLS 1.3 les protège en transit, bcrypt protège les mots de passe, et une chaîne SHA-256 prouve que le journal d'audit est intact — toutes des primitives qui sont dans l'ensemble recommandé de BSI TR-02102-1, avec les variables d'environnement de contrôle ci-dessus pour que tu puisses vérifier ta propre instance.

La couche sous l'application est l'hôte lui-même : [Durcissement](/fr/self-hosted/operate/security/hardening) couvre l'allowlist d'egress, l'isolation des conteneurs et les attentes de chiffrement de disque que cette page présuppose, et [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops) est le guide opérationnel pour la clé age dont ces algorithmes dépendent.
