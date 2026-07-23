# PII fixture corpus — provenance and licensing

## Frozen data

The per-locale `positives.json` / `negatives.json` files in this directory
are **frozen test data**: 43 locales, ~67k cases, generated once from
distilled public-dataset slices and validated against the reference engine.
They are not regenerated — the generator and its dataset snapshots were
retired with the legacy backend, and the corpus is committed as the
ground truth the rewritten engine must keep matching. Extending coverage
means adding cases (or a new locale directory) by hand or with a new,
deliberate tool — never editing existing cases to make a failing engine
pass.

Each file's `_meta` block records the generator version, seed, and dataset
snapshot dates it was produced from.

## Upstream dataset attribution

The generated cases are derivative works of slices from these public
datasets:

| Source                                                            | SPDX                  | Used for                                              |
| ----------------------------------------------------------------- | --------------------- | ----------------------------------------------------- |
| [OpenStreetMap](https://www.openstreetmap.org/) (Geofabrik dumps) | `ODbL-1.0`            | Distilled street-name samples per country             |
| [OpenAddresses](https://openaddresses.io/)                        | `CC0-1.0` / `CC-BY-*` | Verified address quads (number + street + city + ZIP) |
| [GeoNames](https://www.geonames.org/)                             | `CC-BY-4.0`           | City names, admin divisions, postcode tables          |
| [libphonenumber](https://github.com/google/libphonenumber)        | `Apache-2.0`          | Per-country phone-number example metadata             |
| [Tatoeba](https://tatoeba.org/)                                   | `CC-BY-2.0-FR`        | Multilingual prose sentences for negative cases       |
| [OSCAR corpus](https://oscar-project.org/)                        | `CC0-1.0` (samples)   | Negative-case prose for low-resource locales          |
| US SSA name lists                                                 | Public domain         | English given/family-name samples                     |

Per ODbL 1.0 §4.4, distilled extracts of OpenStreetMap data are Derivative
Databases and inherit the license: anyone redistributing these fixture
files (forking the platform, vendoring the tests, publishing extracts)
must retain this attribution and license the redistributed extracts under
ODbL 1.0. The engine itself (`services/platform/lib/pii/`) carries the
repository's default license and is not subject to ODbL.
