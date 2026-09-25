/**
 * Send this tab to another site — a vendor's consent page the flow comes back
 * from on its own. One named seam rather than a bare `location` write, so the
 * dialog's redirect can be asserted without a browser leaving the test.
 */
export function leaveFor(url: string): void {
  window.location.assign(url);
}

/**
 * Load this page again, so the sign-in in front of the gateway can run.
 *
 * A gate signs a browser in only on a page load: it sends the tab to its
 * identity provider and back to this address. The panel's own requests
 * cannot follow it there (see `isSignedOut`), so this is the one way back in
 * once the session has run out.
 */
export function reloadPage(): void {
  window.location.reload();
}
