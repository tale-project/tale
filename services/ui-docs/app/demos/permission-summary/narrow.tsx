import { PermissionSummary } from '@tale/ui/permission-summary';

export default function PermissionSummaryNarrow() {
  return (
    <div className="w-full max-w-[17.5rem]">
      <PermissionSummary
        title="Was dieser Agent in Acme darf"
        items={[
          {
            label:
              'Automatisierungen, Läufe und Versionsstände vollständig lesen',
            allowed: true,
            detail: 'Verwaltungsvorschriftenänderungsbefugnisse inbegriffen.',
          },
          {
            label: 'Einstellungen ändern',
            allowed: false,
            detail: 'Deine Rolle in dieser Organisation erlaubt das nicht.',
          },
        ]}
        footer="Begrenzt durch deine Rolle: Entwickler."
      />
    </div>
  );
}
