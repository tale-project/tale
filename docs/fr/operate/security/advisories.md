---
title: Processus de Security Advisory
description: Comment Tale coordonne, dépose et publie les correctifs liés à la sécurité.
---

Comment Tale coordonne, dépose et publie les correctifs liés à la sécurité.

## Canaux

- **Principal** : [GitHub Security Advisories](https://github.com/tale-project/tale/security/advisories) sur `tale-project/tale`. Les advisories sont préparées en privé, liées à un CVE quand applicable, puis publiées une fois une version patchée disponible.
- **Secondaire** : chaque advisory est référencée dans les release notes GitHub correspondantes sous la section `## 🔒 Security` (voir [format des release notes](/fr/operate/release-notes/format)).
- **Notification directe** (manuelle pour l'instant) : les advisories critiques sont envoyées par e-mail aux opérateurs connus. Il n'existe pas encore de liste e-mail automatisée — c'est prévu.

## Quand déposer une advisory

On dépose un GitHub Security Advisory quand l'un des points suivants s'applique :

- Score CVSS v3.1 ≥ 4.0 (Medium ou plus).
- Tout bug susceptible de fuiter des secrets entre tenants, des session tokens ou d'escalader des privilèges.
- Tout correctif touchant authentification, session, cadrage d'organisation, crypto ou stockage de secrets — même sans rapport externe.
- Toute CVE de dépendance atteignable (le chemin de code vulnérable est exercé par Tale).

**On ne dépose pas** d'advisory pour des CVE de dépendance dont les chemins ne sont clairement pas atteints — documente-les dans la section `## 🔒 Security` normale des release notes avec une note expliquant pourquoi elles ne sont pas exploitables ici.

## Matrice gravité → escalade

| CVSS             | Advisory    | Release notes            | E-mail direct aux opérateurs                                           |
| ---------------- | ----------- | ------------------------ | ---------------------------------------------------------------------- |
| Critical (9.0+)  | Requise     | Requise, résumé en avant | Oui — avant divulgation publique si coordonnée, sinon à la publication |
| High (7.0–8.9)   | Requise     | Requise                  | Seulement si l'exploitation ne demande aucune action utilisateur       |
| Medium (4.0–6.9) | Requise     | Requise                  | Non                                                                    |
| Low (<4.0)       | Optionnelle | Requise                  | Non                                                                    |

## Calendrier

1. **Brouillon privé** dans GitHub Security Advisory. Inclure versions affectées, description, estimation de gravité.
2. **Demander un CVE** via l'UI Advisory de GitHub si gravité ≥ Medium.
3. **Préparer la release patchée** sur un fork/branche privée. Ne pas pousser les patchs sur `main` avant publication.
4. **Divulgation coordonnée** avec le rapporteur en cas de signalement externe — typiquement 90 jours max d'embargo, plus court pour les problèmes activement exploités.
5. **Publier l'advisory** en même temps que la disponibilité du `tale upgrade` patché. Référencer CVE et tag de release.
6. **Lien croisé** dans les release notes de la version patchée.

## Contenu d'une advisory

- Versions affectées (plage ou liste).
- Version patchée (tag exact, ex. `v1.6.1`).
- Résumé de l'impact — ce qu'un attaquant pourrait faire.
- Prérequis — position réseau, état d'auth, feature flags nécessaires pour exploiter.
- Contournements pour les opérateurs qui ne peuvent pas upgrader tout de suite.
- Credits au rapporteur (avec accord).

## Action opérateur

Les opérateurs devraient :

- suivre les releases de `tale-project/tale` (`GitHub → Watch → Custom → Security advisories`, gratuit) ;
- traiter les entrées `## 🔒 Security` comme des invitations à mettre à jour ;
- s'abonner à la liste de notification directe (quand elle existera) pour les alertes critiques.

## Lié

- [Format des release notes](/fr/operate/release-notes/format) — où vivent les entrées Security dans les notes.
- La slash-command `/release` du dépôt principal rédige la section Security.
