/**
 * A value that is not there: a dash to the eye, `label` ("Unknown", "No
 * details") to a screen reader, which would otherwise read a dash as nothing or
 * as punctuation. The list's cell says which word fits.
 */
export function NoValue({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}
