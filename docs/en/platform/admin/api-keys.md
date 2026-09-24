---
title: API keys
description: Create, verify, rotate, and revoke credentials for software that calls Tale.
---

Create an API key when a script or service needs to call Tale's REST API. The key acts as the person who created it and follows that person's current permissions in the organization. Owners, Admins, and Developers manage their keys under **Settings > API > REST**.

<Frame caption="Settings > API > REST — where keys are created, rotated, and revoked.">

![The Create API key dialog asks for a descriptive name and an expiry before a key is generated.](/images/get-started/settings-api-keys.webp)

</Frame>

## Create a key

1. Select **Create API key**.
2. Enter a **Key name** that identifies the caller, such as `Billing sync` or `Document import`.
3. Choose **Expiration**: 7, 30, or 90 days, one year, or never. The form starts at 30 days.
4. Create the key and copy its secret into the caller's approved secret store before closing the confirmation.

The complete secret is shown once. The table later shows only a masked fragment, the creation date, and when the key was last used. It lists your keys, not your teammates' keys.

<Warning>

Anyone holding a key can act with its owner's permissions. Keep it out of source code, chat messages, screenshots, and logs. Use an account with only the access the integration needs.

</Warning>

## Verify the caller

Follow the authenticated request in the [API quickstart](/get-started/developers). Confirm the returned identity and organization before starting a write or import. After an authenticated request, check **Last used** in the key table.

A successful authentication does not guarantee permission for every resource. Project access and the key owner's current role still apply. If a request fails, use the API's error response to distinguish an expired or revoked key from missing resource permissions.

## Rotate without an outage

1. Create a replacement key before the old one expires.
2. Update the caller's secret store and restart or reload it as its configuration requires.
3. Run an authenticated request with the replacement and check that it works.
4. Revoke the old key only after every dependent caller has moved.

Tale does not automatically rotate keys. Key creation and revocation happen in this UI, not through `/api/v1`. A caller can inspect its key's name and expiry through `GET /api/v1/me` and alert the responsible person before expiration.

## Revoke a key

Open its row menu, select **Revoke key**, and confirm. Future requests with the key can no longer authenticate. Revocation cannot be undone; create a new key if you revoke the wrong one.

Do not use an old **Last used** date as the only reason to revoke a key. A monthly job or a recovery process may legitimately be idle. Check the caller identified by the name first.

## Understand permissions and limits

Role changes take effect for existing keys on subsequent requests. Disabling the owner's membership removes their access; a key does not preserve the role it had when created.

Give an integration the narrowest access that works. A notification mirror, for example, does not need an Admin account: an Admin can grant an ordinary member the `tale:notifications.export` capability, which permits that export and none of the other rights of the Admin role. The grant applies only in that organization, can expire, and ends when the member is removed. Grant it under [Competences](/platform/admin/governance/competences), where an integration that relays people's answers and review decisions gets `tale:rest.act-as` the same way; [Delegate the export without an Admin role](/develop/api-reference#delegate-the-export-without-an-admin-role) covers the API side.

REST rate limits apply to the authenticated key holder. Several keys owned by the same person do not provide separate rate-limit allowances. See [Rate limits](/develop/rate-limits). A [budget rule](/platform/admin/governance/policies-and-limits) can additionally cap what requests authenticated with one key may spend: their usage counts toward the key, and a send over the cap is refused with `429 BUDGET_EXCEEDED`. Automation runs started with the key count toward it as well, alongside the personal limits of the member the key acts for. [How usage is counted](/platform/admin/governance/usage-attribution) has the full rule.

API keys authenticate software calling Tale. [Connector credentials](/platform/admin/connectors) serve the other direction: they let Tale call an external service.
