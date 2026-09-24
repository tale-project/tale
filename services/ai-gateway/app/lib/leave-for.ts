/**
 * Send this tab to another site — a vendor's consent page the flow comes back
 * from on its own. One named seam rather than a bare `location` write, so the
 * dialog's redirect can be asserted without a browser leaving the test.
 */
export function leaveFor(url: string): void {
  window.location.assign(url);
}
