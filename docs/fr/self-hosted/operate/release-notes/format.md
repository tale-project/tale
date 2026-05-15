---
title: Format des release notes
description: Format de référence pour les release notes GitHub de tale-project/tale.
---

Tale publie son historique de versions sous forme de release notes GitHub contre le dépôt `tale-project/tale`, dans une forme fixe pour que les exploitants puissent scanner une release avant un upgrade pour les trois choses qui comptent — relevance sécurité, changement de comportement, breaking change — sans lire chaque bullet. Cette page est le contrat : elle nomme chaque section, l'ordre dans lequel elles apparaissent, le cadre que chaque release partage, et les règles de classification qui décident où atterrit chaque bullet. La slash-command `/release` du dépôt principal rédige les notes selon cette spec, et le viewer **What's new** dans le produit rend le même Markdown.

## Pourquoi cette spec

Les opérateurs et utilisateurs comptent sur les release notes pour savoir :

- si un correctif de sécurité les concerne ;
- si un changement de modèle ou fournisseur modifiera leurs sorties de workflow ;
- si une mise à jour demande des étapes manuelles.

Des sections cohérentes — dans un ordre cohérent — rendent facile de scanner une release pour ces trois points sans lire chaque bullet.

## Sections obligatoires

Inclure seulement les sections avec contenu. Toujours dans cet ordre :

| N°  | Titre de section         | Portée                                                                                             |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| 1   | `## 🔒 Security`         | correctifs CVE, patchs de dépendance, durcissement auth/session/crypto, gestion de secrets         |
| 2   | `## 🤖 Model & Provider` | swap/upgrade/dépréciation de modèle LLM, changements de config fournisseur qui modifient la sortie |
| 3   | `## 💥 Breaking Changes` | suppression/renommage d’API, migrations manuelles de schéma, fonctionnalités retirées              |
| 4   | `## 🚀 Features`         | nouvelles fonctionnalités visibles par l’utilisateur                                               |
| 5   | `## ⚡ Performance`      | gains de performance mesurables à mettre en avant                                                  |
| 6   | `## 🛠 Improvements`     | améliorations non breaking, polish UX                                                              |
| 7   | `## 🐛 Fixes`            | correctifs de bugs (non sécuritaires)                                                              |
| 8   | `## 📝 Other`            | docs, refactors, chores — avec parcimonie                                                          |

## Cadre obligatoire

Chaque release doit contenir au minimum :

1. **Titre** : `v{version} — {tagline court}`, ex. `v1.6.0 — Usage analytics & multi-tenancy`.
2. **Résumé** : 2–3 phrases en tête décrivant quoi et pourquoi. Sans emoji.
3. **Instructions de mise à jour** :

   ```markdown
   ## Upgrade

   Run `tale upgrade` to update the CLI, then `tale deploy` to apply the new version.
   ```

   Les deux étapes sont nécessaires — `tale upgrade` récupère le CLI, `tale deploy` l’applique. Omettre l’une laisse le déploiement sur l’ancienne version.

4. **Notes de migration manuelle** (si pertinent) : si une breaking change demande une action opérateur au-delà de `tale deploy`, inclure une section `## Migration Guide` avec étapes numérotées.
5. **Lien Full Changelog** en bas :
   ```markdown
   **Full Changelog**: https://github.com/tale-project/tale/compare/v{previous}...v{new}
   ```

## Règles de classification

- **Security** : tout ce qui touche à l’authentification, session, stockage de secrets, crypto ou CVE de dépendance atteignable. Dans le doute, classer en security ET ouvrir un [Security Advisory](/fr/self-hosted/operate/security/advisories).
- **Model & Fournisseur** : tout changement susceptible de modifier la sortie LLM pour la même entrée utilisateur — bumps de modèle, swaps de fournisseur, changements de prompts/templates dans les agents par défaut.
- **Breaking Changes** : l'utilisateur ou l'exploitant doit faire quelque chose après la mise à jour. Si l'upgrade « passe sans rien faire », ce n'est pas breaking.
- **Other** : uniquement pour des changements notables qui ne rentrent nulle part ailleurs. Trivial (fautes de frappe, refactors internes, changements de tests seuls) est omis.

## Exemple

```markdown
# v1.6.0 — Usage analytics & multi-tenancy

This release adds time-based usage analytics, hardens multi-tenant org isolation,
and bumps the default reasoning model. No breaking changes.

## 🔒 Security

- Tighten org-scoping on governance policy queries (#1573)

## 🤖 Model & Provider

- Default reasoning model bumped from Opus 4.6 → Opus 4.7 (#1590)

## 🚀 Features

- Time-based usage analytics dashboard under `/metrics/usage` (#1574)
- Multi-org support: users can belong to multiple organizations (#1573)

## 🛠 Improvements

- Tabs underline variant adopted across settings surfaces (#1571)

## 🐛 Fixes

- Fix prompt library sidebar scroll on short viewports (#1572)

## Upgrade

Run `tale upgrade` to update the CLI, then `tale deploy` to apply the new version.

**Full Changelog**: https://github.com/tale-project/tale/compare/v1.5.2...v1.6.0
```

## Où cela s'inscrit

Le format des release notes est le contrat entre Ruler GmbH et chaque exploitant qui fait tourner une instance Tale auto-hébergée. Le même Markdown que rend le viewer [What's new](/fr/platform/admin/changelog) dans le produit est ce que les lecteurs consultent avant `tale deploy` ; c'est la forme cohérente qui rend les notes scannables. La slash-command `/release` du dépôt principal rédige les notes selon cette spec. Pour les correctifs de niveau sécurité qui méritent en plus une divulgation CVE, [Avis de sécurité](/fr/self-hosted/operate/security/advisories) est la surface parallèle.
