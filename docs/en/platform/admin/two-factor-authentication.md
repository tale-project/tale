---
title: Two-factor authentication
description: Protect your account with an authenticator or passkey, keep recovery codes, and roll out an organization policy.
---

Protect your account with an authenticator app or a passkey. Members set up their own sign-in methods in **Settings > Account**; admins can require a second factor and help a member recover access.

## Choose a sign-in method

| Method | What you need | How you use it |
| --- | --- | --- |
| Authenticator app | A Tale password and an app that supports time-based codes (TOTP) | Enter your password, then the app's six-digit code. |
| Passkey | A compatible device or security key | Approve the browser's sign-in prompt with your device or key. You can also use it after a password sign-in. |
| Backup code | A saved code from authenticator setup | Use it once in place of an authenticator code when you cannot access the app. |

A passkey satisfies Tale's two-factor policy even if you have never set up an authenticator. Accounts that sign in only through SSO do not show authenticator setup because it requires a Tale password; your organization's SSO exemption determines whether you need a Tale passkey.

## Set up an authenticator

1. Open **Settings > Account**, find **Security**, and select **Enable two-factor**.
2. Enter your current Tale password and select **Confirm**.
3. Scan the QR code with your authenticator app. If scanning is unavailable, enter the displayed setup secret manually in the app.
4. Enter its current six-digit code in **Verification code**, then select **Verify and enable**.
5. Download or copy the backup codes before selecting **Done**. Tale does not display them again.

The account page now confirms that two-factor authentication is active. At your next password sign-in, enter a code from the same authenticator entry.

<Tip>
Keep recovery codes somewhere you can reach without the device you use to sign in, such as a password manager available on another trusted device.
</Tip>

## Add a passkey

1. Under **Settings > Account > Security**, select **Add a passkey**.
2. Give **Passkey name** a recognizable name, such as `Work laptop`.
3. Leave **Authenticator type** on **Any (recommended)** to see the browser's available options, or choose the built-in device authenticator or a security key/phone.
4. Select **Add a passkey** and complete the browser prompt.

The passkey appears in your account's list. On the sign-in page, choose **Sign in with a passkey**. After a password sign-in, **Use a passkey instead** is also available on the verification screen.

To stop using a passkey, select its **Remove** button and confirm. If it was your only second factor and the organization requires one, you must set up another.

## Recover access and replace codes

On the verification screen, select **Use a backup code instead** and enter one saved code. Each code works once. After signing in, open **Settings > Account** and select **Regenerate backup codes** if you need a fresh set; confirm your password and save the new codes. This invalidates every previous code, including unused ones.

If a code is rejected, check that you selected the authenticator entry for this Tale account, use the current code, and check the device's clock. Repeated failures can temporarily block verification; follow the message shown instead of repeatedly submitting.

If you have no usable authenticator, passkey, or backup code, contact an organization admin. Do not send them your password, setup secret, or remaining codes.

## Require a second factor for the organization

Admins configure the policy in **Settings > Governance > Security**. Arrange a recovery contact and give members time to set up a method before enabling it.

<Frame caption="The Security settings page contains password, sign-in, and two-factor policies. Scroll to Two-factor authentication for the enrollment policy.">

![Security settings showing sign-in limits and password requirements above the two-factor policy.](/images/platform/governance-security-monitoring.webp)

</Frame>

| Setting | Effect |
| --- | --- |
| **Require two-factor authentication** | Enables the requirement after confirmation. A registered passkey or authenticator satisfies it. |
| **Grace period (days)** | Time to enroll, counted from the member's first sign-in under the policy. Zero requires enrollment immediately. |
| **Exempt SSO-only users** | Lets members without a Tale password rely on their identity provider's authentication. |

During the grace period, members see a reminder. After it expires, Tale blocks organization access until they enroll. Disabling your personal authenticator does not exempt you from this policy.

## Help a locked-out member

Verify the person's identity through your organization's recovery process first. Then open **Settings > Members**, edit the member, and select **Reset two-factor**. Confirming clears their authenticator setup and ends all active sessions. They can sign in again and set up a new authenticator; an enforced policy requires enrollment before they continue.

For a lost passkey, remove that credential in the member dialog's **Passkeys** section instead. Admin removal also ends all of that member's sessions. Review recovery actions in [audit logs](/platform/admin/governance/audit-logs).
