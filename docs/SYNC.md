# Save sync (Supabase)

Optional. Without it the app keeps every playthrough in this browser only. With it, saves also live in your own free
Supabase project, so clearing the browser, switching phone or sharing a table does not lose them.

## What protects it

1. **Sign-ups are off.** Only the account you create by hand exists.
2. **Password + TOTP code** (an authenticator app). The database only accepts a session that passed the TOTP step:
   the row-level security policy in `supabase-setup.sql` checks `aal2`. A stolen password alone reads and writes nothing.
3. **The public key is harmless.** `js/config.js` holds the project URL and the anon key. They are meant to be public; the
   anon role has no access to the table.
4. Signed out, the app sends nothing anywhere.

Only game saves are stored, plus your own private copy of the book's room text and ability notes (see "The book's text on your other devices" below). Nothing is ever put in the public repo.

## One-time setup (about 10 minutes, free tier)

1. Create a project at supabase.com (any region near you). Keep the database password somewhere safe; the app never needs it.
2. **SQL Editor** → paste `docs/supabase-setup.sql` → Run.
3. **Authentication → Sign In / Providers**, section **User Signups** (the first block on the page): switch **off**
   "Allow new users to sign up" and press **Save changes**. Further down, under **Auth Providers → Email**, set the
   minimum password length to 12 or more.
4. **Authentication → Users → Add user → Create new user**: your email and a long password, tick "Auto Confirm User".
5. **Authentication → Multi-Factor** (left menu, under Configuration): make sure **TOTP** is enabled.
6. **Project Settings → API Keys**: copy the **Publishable key** (`sb_publishable_…`; older projects call it the "anon
   public" key) and the project URL (`https://<ref>.supabase.co`) into `js/config.js` (`supabaseAnonKey`, `supabaseUrl`).
   Never copy a **secret** key (`sb_secret_…`) or the `service_role` key anywhere.
7. Open the app → Settings → Sync: sign in with email and password. The first time it shows a QR code (drawn by the app
   itself from the setup link, `js/qr.js`, so it does not depend on an image from the server): scan it with
   an authenticator app (Aegis, Google Authenticator, 1Password, ...) and type the 6-digit code. After that every
   sign-in asks for a code.

Keep the TOTP secret (or a backup code from your authenticator app) safe: losing it locks you out of the cloud copy
(the local copy still works). You can delete the factor under Authentication → Users and enrol again.

## The book's text on your other devices

The room briefings, lore, rules and enemy stat tables, and the ability and equipment notes, are the book's text. They are not
in the public repo, so the deployed site cannot show them by itself. They live in your `local/` files; to see them on your
phone or on GitHub Pages too, keep a private copy in your database:

1. Run `docs/supabase-setup.sql` again (it only adds the `private_files` table; the rest is safe to repeat).
2. Open the app from the project folder (`python3 -m http.server 8000`), sign in under Settings → Sync, and press
   **Copy room texts to my database**. Do it again whenever the `local/` files change.
3. On any other device or the deployed site: sign in. The texts download by themselves. Signing out removes them from that browser.

The table has the same lock as the saves (your password and a TOTP code).

## Several players

Each person needs their own Supabase user, which means their own copy of the data. Sharing one playthrough between two
accounts is not built. Two players on one table can share the account (and its authenticator app).

## How syncing behaves

- The browser copy stays the main one, so the app is fast and works offline.
- It is automatic: after a change the app uploads that playthrough a moment later (at once when you leave the tab), and
  pulls everything when it opens, when you come back to the tab, when the connection returns, and every minute while it
  is open. The newest change of a playthrough wins, by the time of its last real change.
- Deleting a playthrough leaves a marker, so your other devices drop it too.
- Do not edit on a device that has been closed for a long time before it has had a chance to pull (just open the app and
  wait for "Synced").

## Good to know

- The sign-in tokens live in this browser's storage (key `ssz-sync-session`), like the saves themselves. They are
  short-lived and refreshed; signing out forgets them. Nothing the app shows is built from unescaped text, so a stolen
  token would need access to your device.
- Your password is never stored by the app, only sent to Supabase when you sign in.
- Offline or a server error never loses anything: the local save is untouched and the next change syncs again.
