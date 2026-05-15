# Committed dataset snapshots

This directory holds the offline source-of-truth for fixture generation.

Each `<locale>/` subdirectory contains small JSON slices distilled from
public datasets (OpenStreetMap, OpenAddresses, GeoNames, Tatoeba). The
slices are committed to git; the generator at `../scripts/gen/` reads only
these files and never touches the network.

## Files per locale

| File                | Source                              | Schema                                   |
| ------------------- | ----------------------------------- | ---------------------------------------- |
| `streets.json`      | OSM Geofabrik (filtered, top-N)     | `StreetEntry[]`                          |
| `cities.json`       | GeoNames (population ≥ 15,000)      | `CityEntry[]`                            |
| `addresses.json`    | OpenAddresses (verified quads)      | `AddressEntry[]`                         |
| `prose.json`        | Tatoeba / OSCAR (PII-stripped)      | `ProseEntry[]`                           |
| `names.json`        | Wikidata / SSA / census             | `NameEntry[]`                            |
| `national-ids.json` | Test vectors for the locale's IDs   | `{ valid: string[]; invalid: string[] }` |
| `_meta.json`        | Per-locale source versions + hashes | `LocaleMeta`                             |

Schemas live at `../scripts/gen/schema.ts` (Zod-validated on read).

## Refreshing

See `../scripts/refresh/README.md` for the manual extraction workflow.
This directory is **only** updated by that workflow; never hand-edit.
