# de-CH — examples

Two override examples. For everything else, read [DE examples](../de/examples.md) and apply the spelling/currency overrides below.

## Override #1 — `ß → ss`

**DE base.** _Klicke auf **Schließen**, um die Sitzung zu beenden. Der Standardmäßig aktivierte Schutz greift, wenn die Anfrage größer als 10 MB ist._

**de-CH override.** _Klicke auf **Schliessen**, um die Sitzung zu beenden. Der Standardmässig aktivierte Schutz greift, wenn die Anfrage grösser als 10 MB ist._

**Why.** Every sharp-s is `ss`. The rest is identical to DE.

## Override #2 — currency + numbers

**DE base.** _Der Plan kostet 100 € pro Monat. Bis zu 1.000 Anfragen sind enthalten._

**de-CH override.** _Der Plan kostet CHF 100 pro Monat. Bis zu 1'000 Anfragen sind enthalten._

**Why.** `CHF` prefix (with NBSP), apostrophe thousands separator. The decimal would also be a period if the example had one (`2.5` not `2,5`).
