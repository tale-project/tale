# Swiss German edits

These examples change presentation while preserving the fact.

## Spelling

DE: “Prüfe die Größe der Datei.”

de-CH: “Prüfe die Grösse der Datei.”

Use `ss` in written Swiss Standard German. Code, filenames, and exact catalog labels keep their
specified bytes.

## Numbers and currency

DE: “Der Beispielbetrag ist 1.000 USD.”

de-CH: “Der Beispielbetrag ist 1'000 USD.”

The thousands separator changes. Both sentences describe one thousand US dollars. It would be
wrong to replace USD with CHF. Use the docs currency-check exception with an explanation when a
locale heuristic rejects the factual currency.
