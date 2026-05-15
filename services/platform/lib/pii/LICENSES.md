# Dataset attribution and licensing

The PII engine code (`@/lib/pii`) is part of the Tale platform codebase
(see the repository-root `LICENSE`). This file records the upstream
licenses of the **public datasets** that feed test fixtures.

Raw datasets are never bundled with the engine. The maintainer workflow
at [`scripts/pii-fixtures/refresh/`](../../scripts/pii-fixtures/refresh/)
extracts small, locale-keyed slices from those datasets and commits the
results to [`scripts/pii-fixtures/datasets/`](../../scripts/pii-fixtures/datasets/).
Generated fixtures under [`test/pii/fixtures/`](../../test/pii/fixtures/)
are derivative works of those committed slices.

## Upstream sources

| Source                                                            | SPDX                  | Used for                                              |
| ----------------------------------------------------------------- | --------------------- | ----------------------------------------------------- |
| [OpenStreetMap](https://www.openstreetmap.org/) (Geofabrik dumps) | `ODbL-1.0`            | Distilled street name samples per country             |
| [OpenAddresses](https://openaddresses.io/)                        | `CC0-1.0` / `CC-BY-*` | Verified address quads (number + street + city + ZIP) |
| [GeoNames](https://www.geonames.org/)                             | `CC-BY-4.0`           | City names, admin divisions, postcode tables          |
| [libphonenumber](https://github.com/google/libphonenumber)        | `Apache-2.0`          | Per-country phone-number example metadata             |
| [Tatoeba](https://tatoeba.org/)                                   | `CC-BY-2.0-FR`        | Multilingual prose sentences for negative-case corpus |
| [OSCAR corpus](https://oscar-project.org/)                        | `CC0-1.0` (samples)   | Negative-case prose for low-resource locales          |
| US SSA name lists                                                 | Public domain         | English given-name / family-name samples              |

## ODbL share-alike note

Per the ODbL 1.0 terms (§4.4), distilled extracts of OpenStreetMap data
are "Derivative Databases" and inherit the same license. Anyone
redistributing the fixture JSON (e.g. by forking the Tale platform,
vendoring these tests, or publishing the extracts elsewhere) must
retain this attribution and license the redistributed extracts under
ODbL 1.0.

The non-fixture parts of the engine (`services/platform/lib/pii/**`)
carry the repository's default license and are not subject to ODbL.

## Per-snapshot attribution

Each per-locale dataset directory under
`services/platform/scripts/pii-fixtures/datasets/<locale>/` carries its
own `_meta.json` recording the upstream version (Geofabrik dump date,
GeoNames version, OpenAddresses collection revision, Tatoeba dump date)
and a SHA-256 of every committed file, so a future maintainer can
reproduce the extraction from raw sources.
