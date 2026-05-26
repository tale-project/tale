---
title: Avis de sécurité
description: Le flux d'avis de sécurité Tale — format CVE, échelle de sévérité à quatre niveaux, calendrier de divulgation auquel les mainteneurs s'engagent, et comment t'abonner.
---

Tale publie un avis de sécurité pour chaque vulnérabilité qui se ferme par une release patchée. Le flux vit sous GitHub Security Advisories sur le dépôt `tale-project/tale` et se miroite vers un endpoint RSS que les opérateurs peuvent brancher dans leur alerting. Cette page couvre le format que suit chaque avis, l'échelle de sévérité que Tale utilise, le calendrier de divulgation auquel les mainteneurs s'engagent, et les trois chemins d'abonnement.

Les avis sont l'enregistrement long format. Le résumé d'une ligne plus un lien apparaît dans la section **Sécurité** de chaque [note de version](/fr/self-hosted/operate/release-notes/format).

## Le format des avis

Chaque avis est un GitHub Security Advisory avec un identifiant stable de la forme `TAL-YYYY-NNN` (ID interne de Tale) plus le `CVE-YYYY-NNNNN` upstream s'il en a un d'attribué. Le corps est le même ensemble ordonné de sections pour qu'un opérateur scanne les faits porteurs sans lire la prose.

- **Résumé** — une phrase nommant ce qu'un attaquant pourrait faire et ce que le fix change.
- **Versions affectées** — la plage de versions qui contient la vulnérabilité, en forme semver (`>=0.8.0, <0.12.3`).
- **Versions patchées** — la première release qui contient le fix. Monter à ou au-delà de cette version ferme la vulnérabilité.
- **Sévérité** — un des quatre niveaux ci-dessous, plus le vecteur CVSS 3.1 pour les opérateurs qui scorent contre leur propre threat model.
- **Contournements** — quoi régler, désactiver ou bloquer pour mitiger la vulnérabilité quand une montée de version immédiate n'est pas possible. Vide quand aucun contournement n'existe.
- **Crédits** — le rapporteur, quand il a demandé à être nommé.

La ligne des versions patchées est celle sur laquelle la plupart des opérateurs atterrissent en premier ; la montée de version elle-même est la séquence à deux commandes de [Montées de version](/fr/self-hosted/operate/upgrades).

## L'échelle de sévérité

Tale utilise quatre niveaux. Le niveau est posé à partir du score CVSS et de l'accessibilité de la surface vulnérable sur un install par défaut.

| Niveau   | CVSS    | Ce que ça veut dire                                                                                                                     |
| -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | 9.0+    | Exécution de code à distance pré-authentifiée ou exfiltration de données non authentifiée. Patche sous 24 heures.                       |
| High     | 7.0–8.9 | Escalade authentifiée, évasion de sandbox ou fuite de données cross-tenant. Patche sous une semaine.                                    |
| Moderate | 4.0–6.9 | Divulgation d'information, déni de service ou escalade demandant des préconditions rares. Patche à la prochaine fenêtre de maintenance. |
| Low      | 0.1–3.9 | Fixes de défense en profondeur et durcissement sans chemin d'exploitation connu. Patche quand ça t'arrange.                             |

Le vecteur CVSS te laisse re-scorer contre ton propre déploiement — un avis noté High contre un install public peut être Low contre un air-gappé.

## Le calendrier de divulgation

Les mainteneurs s'engagent sur le calendrier suivant à partir du moment où un rapport atterrit à `security@tale.dev` :

- **Sous 72 heures** — accusé de réception, un triage call et un identifiant TAL attribué.
- **Sous 14 jours** — un fix ou un contournement publié en privé au rapporteur, et la version patchée planifiée.
- **À la sortie du fix** — l'avis est publié sur GitHub, l'attribution du CVE est demandée, et la section sécurité des notes de version porte le résumé.
- **30 jours après la sortie** — le détail technique dans l'avis s'étend avec le reproducteur (quand reproduire en public ne met plus en risque les installs non patchés).

Les rapporteurs peuvent demander un délai s'ils ont besoin de plus de temps pour divulguer ; les mainteneurs acceptent jusqu'à 90 jours avant de publier le résumé malgré tout.

## S'abonner

Trois chemins vers le même flux :

```text
Watch GitHub     — github.com/tale-project/tale → Watch → Custom → Security alerts
RSS              — https://github.com/tale-project/tale/security/advisories.atom
Digest courriel  — security-announce@tale.dev (un courriel par avis, pas de trafic entre)
```

Le flux RSS est ce que la plupart des opérateurs branchent dans Slack ou PagerDuty ; le digest courriel est pour les équipes d'une personne qui ne font pas tourner de pipeline d'alerting.

## Où cela s'inscrit

Le flux des avis est un des deux contrats qui rendent Tale auto-hébergeable sereinement — les notes de version nomment ce qui change, les avis nomment ce qui n'allait pas. Les prochaines lectures naturelles sont [Comment lire les notes de version](/fr/self-hosted/operate/release-notes/format) pour le format de changelog correspondant et [Durcissement](/fr/self-hosted/operate/security/hardening) pour la checklist qui limite l'exposition avant qu'un avis ne tire.
