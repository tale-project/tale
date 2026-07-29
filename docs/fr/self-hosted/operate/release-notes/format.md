---
title: Comment lire les notes de version
description: La forme que suivent les notes de version de Tale — la promesse semver, où vivent les changements breaking et les obsolescences, comment les entrées de sécurité sont marquées et où vivent les notes de migration par version.
---

Tale publie une version par minor et des patches comme tags correctifs entre elles. Les notes de version pour chaque tag suivent la même forme afin que tu puisses en scanner une en une minute et savoir si la montée de version est un bump de cinq minutes ou une fenêtre de maintenance. Cette page couvre le format : la promesse semver, ce que chaque section garantit, et où lire plus en profondeur quand une ligne pointe vers une migration.

Les notes elles-mêmes vivent sur la page de release GitHub de chaque tag. La CLI les fait aussi remonter — `tale update --notes` imprime les notes de la version qu'elle est sur le point d'installer.

## La promesse semver

Les versions Tale sont en semver, et le numéro de version est le fait principal d'une montée de version.

- **Patch (`0.9.0 → 0.9.1`)** — corrections de bugs uniquement. Pas de migration de schéma, pas de changement de config, pas de changement de comportement autre que le fix lui-même. Sûr à monter sans lire au-delà de la section sécurité.
- **Minor (`0.9.x → 0.10.x`)** — nouvelles fonctionnalités, possiblement des migrations forward-only. Rétrocompatible par défaut ; les obsolescences sont annoncées une minor à l'avance. L'exception permanente est la 0.4.0 : une minor de rupture qui exige un déploiement neuf (voir [Montées de version → 0.3 → 0.4](/fr/self-hosted/operate/upgrades)).
- **Major (`0.x → 1.x`)** — les changements breaking sont permis. Porte toujours un lien vers les notes de migration en haut de la release ; lis-les de bout en bout avant de commencer.

La ligne de version en haut de chaque page de release nomme le type de bump en clair pour que tu n'aies pas à faire l'arithmétique toi-même.

## Les sections que chaque release a

Chaque page de release est la même liste ordonnée de sections. Les sections vides sont omises, pas laissées vierges — si tu ne vois pas une section, c'est qu'il n'y a rien à rapporter là.

- **Highlights** — un ou deux paragraphes nommant à quoi sert la release. Lis ça en premier.
- **Changements breaking** — chaque changement qui demande à l'opérateur de faire quelque chose avant ou après la montée de version. Chaque ligne nomme le symptôme que tu rencontrerais si tu sautais, et l'action qui l'évite.
- **Obsolescences** — fonctionnalités qui marchent encore dans cette release mais marquées pour suppression. Chaque ligne nomme la version de suppression pour que tu planifies la bascule.
- **Sécurité** — entrées au format CVE pour les fixes qui ferment une vulnérabilité. Le flux complet vit sous [Avis de sécurité](/fr/self-hosted/operate/security/advisories) ; les notes de version portent le résumé d'une ligne plus le lien vers l'avis.
- **Fonctionnalités et corrections** — la longue liste. Groupée par domaine (Platform, CLI, Docs) ; chaque ligne se lit comme une phrase.
- **Notes de migration** _(versions majeures et certaines mineures)_ — le parcours lié à travers les migrations de schéma, les changements de fichier de config ou les renommages côté opérateur. À lire systématiquement pour les majeures.

## Comment scanner une release

Lis la ligne de version, les highlights et la section des changements breaking. Si la section breaking est vide et que la section sécurité ne nomme pas un fix qui touche ton install, la montée de version est la séquence `tale update` + `tale deploy` depuis [Montées de version](/fr/self-hosted/operate/upgrades). Si l'une ou l'autre des sections a des lignes, parcours-les avant de lancer `tale deploy`.

```text
0.12.0 (minor) — 14/05/2026

Highlights
  Les tool calls en streaming streament maintenant dans le chat à mesure qu'ils émettent.

Changements breaking
  (aucun)

Obsolescences
  AGENTS_LEGACY_PROMPT env var — retirée en 0.14.

Sécurité
  CVE-2026-XXXX — bypass patché dans la sandbox run-code.
  Voir : avis TAL-2026-007.
```

La forme ci-dessus est ce qu'imprime `tale update --notes`. La version web de la même release ajoute des liens sur chaque ligne d'avis et de migration.

## Où cela s'inscrit

Le format des notes de version est le contrat entre le projet et l'opérateur — la même forme à chaque release pour que la décision de montée de version soit un scan, pas une lecture profonde. Les prochaines étapes naturelles sont [Montées de version](/fr/self-hosted/operate/upgrades) pour la mécanique de déploiement et [Avis de sécurité](/fr/self-hosted/operate/security/advisories) pour le flux long format des vulnérabilités vers lequel la section sécurité pointe.
