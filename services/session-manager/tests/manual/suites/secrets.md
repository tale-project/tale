# Secrets

> **Prefix** `SECRET-` · **Reset** once, at the start · **Cost** ~25 min

The Secrets section where your own computer and your own browsers are part of the test: the real
clipboard, masked fields in three browsers, a value that was meant to stay out of sight turning up in
a place only devtools show (storage, a URL), and a long list. What the specs hold (the form and its
limits, masking by label and by card number, reveal and hide, scope, filters, search, the details, delete,
the keyboard, the list following the backend) is in
[`../reference/automation.md`](../reference/automation.md); a box here never restates it. Typing a
secret into a real page is in [`viewer.md`](viewer.md) (`VIEW-F34`); an assistant reading one is in
[`settings.md`](settings.md).

## Preconditions

Stack A or B after a reset, with a Credentials secret named `Example shop` for every session
([`../setup.md`](../setup.md)). A 1440×900 viewport, devtools open on the Network panel. Test values
only: never a real card number or password in a round.

> **Agent note**: the table is the region "Secrets" (`secrets.table.caption`); a row opens with a click
> on its title (a button named after the title) or with **View** in its menu ("Actions for {title}",
> `secrets.table.actionsFor`), which opens the dialog "Secret details" with **Edit** in it. A hidden
> single-line value is a real `input` of type `password` (`autocomplete="off"`, the opt-out hints of
> 1Password, LastPass and Bitwarden) and turns into type `text` after **Show {label}**: assert on the field's
> `type`. A hidden value of several lines is a text area drawn as dots by CSS, and the details dialog shows
> every hidden value as the word "Hidden" until **Show {label}**.

## Your computer and your browsers

- [ ] `SECRET-F3` · **Open the secret `Example shop`, press Copy Password (`secrets.row.copy`) next to its hidden
  password, and paste into a text editor; then do the same in the form of Edit (`secrets.actions.edit`)** → the
  editor receives the password's text although the page only ever showed "Hidden" or dots; the button shows a
  check for a moment and a screen reader hears "Password copied" (`secrets.row.copied`); nothing about the copy
  changes what is saved.
- [ ] `SECRET-F14` · **Add a Credentials secret in Chrome, in Firefox and in Safari (the browsers that show the
  manager)** → in each the hidden fields are dots, not text; **Show Password** reveals and **Hide Password**
  masks again (`secrets.row.show`, `secrets.row.hide`); no browser offers to save a password when the dialog is
  saved, and none offers to fill one into the field.

## Where a secret may show

- [ ] `SECRET-F13` · **With the Network panel open, load Secrets, open a secret with a password and close it, then
  look in devtools at Application: local storage, session storage and cookies** → the list's answer
  (`GET /api/secrets…`) holds ids, titles, kinds, previews and dates and no field value of any kind; the values
  come with `GET /api/secrets/{id}` when a secret is opened (the viewer's popover does the same when you open
  one secret); no value is in a URL, in `localStorage`, in `sessionStorage` or in a cookie.
- [ ] `SECRET-P1` · **Create 500 secrets (stack A: a loop of `POST /api/secrets` with a one-line note each), open
  Secrets, scroll and search** → the list opens in about a second, scrolls without lag, and a search answers as
  you type.
