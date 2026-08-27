# Repo Manager

A full file manager for your GitHub repositories — switch between any repo your
token can see, browse a folder tree, edit code inline, preview images,
drag-and-drop to move things, and upload or download zips. Deploys as a single
Cloudflare Worker; the GitHub token stays server-side (a Worker secret) and
never reaches the browser.

## What's new in this update

- **Multiple repositories, one deployment.** A repo switcher (search + recents
  + branch picker) lets you jump between any repo your token can access — no
  more one-repo-per-deployment. The active repo and your recent list are saved
  server-side in Workers KV, so they're the same on every device you sign in
  from.
- **Mobile-first layout.** On a phone, the folder tree, file list, and editor
  behave like separate full-screen views with their own back/menu controls,
  instead of being squeezed side-by-side. Desktop keeps the full three-pane
  layout with everything visible at once.
- **Select all / deselect all** for the current folder, plus a selection
  counter, so bulk delete/zip work on everything at once instead of one
  checkbox at a time.
- **Zip a folder directly** — "Download this folder as .zip" in the toolbar
  menu, and a per-row zip button on every folder — in addition to zipping a
  mixed selection of files and folders.
- **Editor extras**: Find-in-file (with next/previous and a match counter,
  <kbd>Ctrl/Cmd+F</kbd>), Select all, and Copy all — reachable from the editor
  toolbar and useful on both desktop and mobile.
- **Reworked login**: a real show/hide password toggle, a plain "Login" button
  (no vague "connecting…" text), and markup that plays nicely with browser
  password managers/autofill.
- **Settings panel** now shows who the token is signed in as, and has a
  "Switch repository" shortcut alongside the existing repo/branch/visibility
  info.

## How it works

- API routes on the Worker:
  - `GET /api/repos` — lists (or searches, via `?q=`) every repo the token can
    see, plus your recent picks and the currently active repo.
  - `GET /api/repos/branches` — branches for a given `owner`/`repo`.
  - `POST /api/repos/select` — sets the active repo/branch (saved in KV).
  - `GET /api/tree`, `GET /api/repo`, `GET /api/blob`, `POST /api/commit` — same
    as before, but every one now takes `owner`/`repo`/`branch`, either as query
    params or falling back to the active repo saved in KV.
  - `GET /api/whoami` — confirms the token and shows the signed-in account.
- The frontend is a static page (`public/index.html` + `public/app.css` +
  `public/app.js`). Zip extraction/creation happens client-side via the
  `fflate` library — the Worker only ever receives the individual files
  you've actually staged, never a zip itself.
- The Worker has its own password (`ACCESS_PASSWORD`) — without it, nobody can
  call `/api/*`.
- A small service worker (`public/sw.js`) caches only the static shell
  (HTML/CSS/JS/icons) for instant loads and installability — it never caches
  `/api/*` responses, so the file tree, blobs, and commits are always live.

## Setup

### 1. Create a GitHub Personal Access Token with access to every repo you want

Since this build manages *multiple* repositories from one token, scope it
accordingly:

GitHub → Settings → Developer settings → Personal access tokens →
**Fine-grained tokens** → Generate new token

- **Repository access**: "All repositories" (or manually pick every repo you
  want to manage — you can add more later by editing the token's repo list)
- **Permissions**: **Contents: Read and write** — nothing else needed
- Copy the token now (it's shown once)

A classic PAT with the `repo` scope also works if you prefer that over
fine-grained tokens.

### 2. Set secrets

```bash
npm install -g wrangler   # if you don't have it
wrangler login

wrangler secret put GITHUB_TOKEN
# paste the token from step 1

wrangler secret put ACCESS_PASSWORD
# choose a password — this is what you log into the tool with
```

### 3. Create the KV namespace (needed for repo switching + login lockout)

```bash
wrangler kv namespace create RATE_LIMIT
```

Paste the `id` it gives you into the `kv_namespaces` section of
`wrangler.jsonc` (a placeholder id is already there — replace it). This KV
namespace now does double duty: it remembers which repo/branch is active
(and your recent repos) across every device, and it powers the login
lockout. The Worker still boots without it, but you'll lose both of those —
worth doing before you rely on this day to day.

`GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH` in `wrangler.jsonc` are now
optional — they're only used as a one-time bootstrap default before you've
picked a repo in the in-app switcher. Safe to leave blank; just open the app
and use "Switch repository" the first time.

How the login lockout works: 5 wrong passwords from one IP triggers a
30-second block; each wrong attempt after that doubles the wait, up to 15
minutes. A correct password resets the counter. The frontend also shows a
countdown, but the real protection is the server-side KV check — the
frontend countdown can't stop a script hitting the Worker directly.

### 4. Deploy

```bash
npm install
wrangler deploy
```

Wrangler prints a `*.workers.dev` URL — that's your file manager. Open it,
log in with the password from step 2, and use **Switch repository** (prompted
automatically the first time) to pick which repo to browse.

### 5. Install it as an app

Once deployed and opened once over HTTPS, most browsers will offer an
**Install** button right in the header (and on the login screen). Tap it and
the tool opens like a native app from then on — its own icon, its own window,
no address bar, no re-typing the URL.

- **Android / desktop Chrome or Edge**: the Install button appears
  automatically once the browser is satisfied the app qualifies (usually
  within a few seconds of the first load).
- **iOS Safari**: iOS has no install-prompt API, so there's no button — open
  the **Share** menu (the square with an arrow) and choose **"Add to Home
  Screen."** The app shows this tip once automatically the first time it's
  opened in Safari.

## Notes

- Switching repos discards any staged (uncommitted) changes in the tool —
  you'll get a confirmation prompt if you have any pending. Commit or discard
  before switching.
- Files over ~200 KB that aren't recognized as text open in a "no preview"
  state in the editor panel rather than trying to load a huge blob into a
  `<textarea>`.
- The repo search box searches by name across repos your token can see; very
  large accounts (hundreds of repos) may want to just type a few letters of
  the name rather than browsing the full list.
