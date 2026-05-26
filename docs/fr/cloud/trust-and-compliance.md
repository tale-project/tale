---
title: Trust et conformité
description: Quelle posture de conformité Tale Cloud apporte, qui audite quoi, quels contrôles sont les tiens, et comment signaler les incidents.
---

Trust et conformité sur Cloud est la page qu'un auditeur veut. Elle nomme les cadres contre lesquels la plateforme est certifiée, sépare proprement les responsabilités entre Tale et ton organisation, liste les contrôles de protection des données à ta disposition, et te dit qui appeler quand quelque chose tourne mal.

Le contenu ici est descriptif — ce qui est livré aujourd'hui, quelles preuves Tale peut fournir sur demande. Les documents légaux eux-mêmes (DPA, conditions, politique de confidentialité) vivent sous [Mentions légales](/fr/legal/privacy) ; cette page est la référence rapide de l'opérateur.

## Un contrôle déroulé — journaux d'audit de bout en bout

Le responsable conformité de l'organisation doit démontrer que « chaque changement de contrôle d'accès est journalisé avec l'acteur, la cible et l'horodatage ». Les [Journaux d'audit](/fr/platform/admin/governance/audit-logs) de Tale enregistrent chaque invitation de membre, changement de rôle, suppression et réinitialisation 2FA avec l'ID utilisateur de l'acteur, l'ID du membre affecté, et un horodatage ISO. Les journaux sont immuables — restaurer un instantané ne les modifie pas — et conservés selon le plancher configuré par l'organisation. Le responsable exporte une plage de dates en CSV, la remet à l'auditeur, et l'exemple déroulé valide le contrôle.

## Certifications et cadres

Tale Cloud est actuellement audité ou attesté contre les cadres suivants ; les rapports de certification sont disponibles sous NDA via le support :

- SOC 2 Type II (annuel)
- ISO/IEC 27001
- Contrôles alignés RGPD (lignes directrices EDPB appliquées)
- Contrôles alignés LPD pour la région Suisse (nLPD)

En attente ou prévus : BAA HIPAA (clients entreprise US), attestations régionales supplémentaires à mesure que la liste des régions s'agrandit.

## Responsabilité partagée

| Contrôle                          | Tale                 | Toi                  | Preuve                                                     |
| --------------------------------- | -------------------- | -------------------- | ---------------------------------------------------------- |
| Disponibilité d'infrastructure    | ✓                    |                      | Page de statut, rapport SLA SOC 2                          |
| Chiffrement des données au repos  | ✓                    |                      | Description d'architecture                                 |
| Chiffrement en transit            | ✓                    |                      | Terminaison TLS par le edge de Tale                        |
| Identité des membres et rôles     |                      | ✓                    | [Membres et rôles](/fr/platform/admin/members-and-roles)   |
| Émission et rotation des clés API |                      | ✓                    | [Clés API](/fr/platform/admin/api-keys)                    |
| Filtrage de contenu et DLP        | Fournit les crochets | Configure les règles | [Guardrails](/fr/platform/admin/governance/guardrails)     |
| Rétention des journaux d'audit    | Fournit le stockage  | Règle la rétention   | [Rétention](/fr/self-hosted/configuration/retention)       |
| Demandes de personnes concernées  | Fournit le workflow  | Initie et approuve   | [DSR](/fr/platform/admin/governance/data-subject-requests) |
| Identifiants fournisseurs         |                      | ✓                    | [Providers](/fr/platform/admin/providers)                  |

## Contrôles de protection des données

Dans le produit, trois surfaces de contrôle comptent pour la conformité :

- **Journaux d'audit** — enregistrement immuable de qui a fait quoi ; rétention configurable.
- **Conservation légale** — exempte un ensemble d'enregistrements de la rétention jusqu'à la levée ; couvert dans [Conservation légale](/fr/platform/admin/governance/legal-hold).
- **Demandes de personnes concernées** — le workflow demande → prise en charge → effacement → audit ; couvert dans [DSR](/fr/platform/admin/governance/data-subject-requests).

## Signaler les incidents

Le contact incident sécurité de Tale est `security@tale.dev`. La divulgation de vulnérabilités présumées suit la politique de divulgation responsable sur le même e-mail. Les bulletins de sécurité côté client sont publiés sur la page de statut et envoyés par e-mail au Owner de l'organisation.

## Où ça s'inscrit

Trust et conformité est la page du moment d'audit ; [Résidence des données](/fr/cloud/data-residency) est la page du moment d'architecture ; [Sous-traitants](/fr/legal/subprocessors) est la page liste-de-vendeurs. Un auditeur veut généralement les trois en même temps — mets-les toutes en favoris. Si tu opères en auto-hébergé, les contrôles sont les mêmes ; ce qui change est qui fait tourner l'infrastructure en dessous — voir [Aperçu auto-hébergé](/fr/self-hosted/overview).
