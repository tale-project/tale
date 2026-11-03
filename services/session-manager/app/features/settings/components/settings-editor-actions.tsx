import { useActiveEditor, EditorActions } from '@tale/ui/editor';
import { MobileFloatingActions } from '@tale/ui/mobile-floating-actions';
import { useIsMobile } from '@tale/ui/use-is-mobile';

/**
 * Save and Discard of the page's editor, in the page header on a computer. They
 * are mounted once: the header's copy and the phone's dock never both render,
 * or each would take the keyboard shortcut. Mirrors `SettingsEditorActionsSlot`
 * and `SettingsMobileActionBar` of the platform
 * (`routes/dashboard/$id/settings.tsx`).
 */
export function HeaderEditorActions() {
  const editor = useActiveEditor();
  const isMobile = useIsMobile();
  if (isMobile || editor === null) return null;
  return (
    <div className="ml-auto flex items-center gap-2">
      <EditorActions controller={editor} entityKind="settings" />
    </div>
  );
}

/** The same cluster for a phone: a dock above the tab bar. */
export function DockEditorActions() {
  const editor = useActiveEditor();
  const isMobile = useIsMobile();
  if (!isMobile || editor === null) return null;
  return (
    <MobileFloatingActions>
      <EditorActions controller={editor} entityKind="settings" />
    </MobileFloatingActions>
  );
}
