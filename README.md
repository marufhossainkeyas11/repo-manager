# Repo Manager

A full file manager for your GitHub repos — folder tree, inline text/code
editor with find-in-file, image preview, drag-and-drop moves, zip
upload/download, and multi-repo switching, all from one page. Deploys as a
single Cloudflare Worker; the GitHub token stays server-side (a Worker
secret) and never reaches the browser. Fully usable on mobile, not just
desktop.

## What's new in this rebuild

- **Multi-repo.** Add as many repos as your token can see, switch between
  them from Settings without redeploying, and browse/search your GitHub
  account to add one instead of typing owner/repo by hand. The repo you
  first configured in `wrangler.jsonc` still works exactly as before — it's
  just the fallback now instead of the only option.
- **Mobile is now a real first-class surface**, not an afterthought:
  - Folder tree opens as a slide-in drawer (hamburger button, edge-swipe,
    backdrop tap, and the Android/iOS back gesture all close it).
  - Rename/duplicate/delete buttons are always visible on touch — no more
    hover-only actions you can't reach with a finger.
  - Selecting files swaps the toolbar for a compact selection bar (count +
    Zip/Delete/Clear), the same pattern as a native file manager.
  - Folder checkboxes, a select-all/deselect-all control, and selecting a
    folder now includes everything inside it for zip/delete.
- **Login page overhaul** — real password manager/autofill support, a
  show/hide toggle, optional "remember me" (persists the password in
  `localStorage` instead of just the current tab), a Caps Lock warning, and
  the repo name on the login screen is now live (togglable in Settings)
  instead of a permanently stuck "connecting…".
- **Editor toolbar**: Select All, Copy contents, and Find-in-file (case
  insensitive, next/prev navigation). `Ctrl/Cmd+F` and `Ctrl/Cmd+S` work
  while the editor is focused.
- **Desktop extras**: right-click context menu (Rename / Move to… /
  Duplicate / Download as .zip / Delete), shift-click range selection,
  drag-to-resize sidebar and editor panels (remembered across sessions), and
  an explicit "Move to…" button so moving files doesn't require drag-and-drop.
- **Folder tree sidebar** (left) + file list (right), VS Code style. Clicking
  a folder's name navigates into it; clicking the chevron only
  expands/collapses — the two are independent, like VS Code.
- **Zip upload respects the current folder.** Browse into `movies/`, drop a
  zip there, and its internal structure unpacks under `movies/...`.
- **Zip download** of any selection of files and/or folders — folders keep
  their name as a wrapper directory with the relative structure inside, loose
  files zip at the root. Shows live "Zipping N/M…" progress.
- **New folder / new file** — new files open straight in the editor; empty
  folders get a small `.gitkeep` so Git tracks them.
- **Inline editor** for text/code files, **image preview** on click, and a
  plain "no preview" state for anything else (binary, video, etc.) — those
  still delete/move/rename fine, just no in-browser view.
- **Staged changes drawer** at the bottom — every add/delete/move queues up
  with a compact diff view (`+added`, `−deleted`, `⇄moved`) before you write a
  commit message and push it all as one commit.
- **Installable as an app (PWA)** — an "Install" button appears (desktop
  Chrome/Edge, Android Chrome) once the browser decides the app qualifies;
  iOS Safari gets a one-time hint pointing at Share → Add to Home Screen.
- English-only UI throughout.

## How it works

- API routes on the Worker:
  - `GET /api/tree` — lists every file in the active repo
  - `POST /api/commit` — any mix of add/delete/rename/move, pushed as a
    single commit via GitHub's Git Data API
  - `GET /api/blob` — fetches one file's content for the editor/preview
  - `GET /api/repo` — active repo metadata for the header/settings panel
  - `GET /api/meta` — **unauthenticated** — just enough (`owner/repo/branch`,
    or `{hidden:true}`) to populate the login screen before a password is
    entered
  - `GET /api/repos` — the full saved-repo registry (active + list)
  - `GET /api/repos/discover?q=` — searches repos your token can see, for
    the "Browse" add-repo tab
  - `POST /api/repos` — add a repo (`{owner, repo, branch?}`); this is what
    actually verifies the token has access before saving anything
  - `PUT /api/repos/active` — switch the active repo
  - `DELETE /api/repos?owner=&repo=` — remove a saved repo (can't remove the
    active one — switch first)
  - `PUT /api/settings` — currently just `{showRepoOnLogin}`
- The frontend is one static page (`public/index.html` + `public/app.js`).
  Zip extraction/creation happens client-side via the `fflate` library — the
  Worker only ever receives the individual files you've actually staged,
  never a zip itself.
- The Worker has its own password (`ACCESS_PASSWORD`) — without it, nobody
  can call `/api/*` (except the intentionally-open `/api/meta`, which never
  returns anything beyond the repo name).
- A small service worker (`public/sw.js`) caches only the static shell
  (HTML/JS/icons) for instant loads and installability — it never caches
  `/api/*` responses, so the file tree, blobs, and commits are always live.

## Setup

### 1. Create a GitHub Personal Access Token

If you only ever plan to manage **one repo**, a fine-grained PAT scoped to
just that repo (as before) still works fine.

If you want to use **multi-repo switching**, the token needs to see every
repo you plan to add:

- **Fine-grained PAT**: set repository access to **"All repositories"**, or
  explicitly select every repo you want to manage (you can add more repos to
  the token's access later without regenerating it, as long as you remember
  to do so before trying to add them here).
- **Classic PAT**: the `repo` scope covers all of this with no per-repo
  configuration.

Either way: GitHub → Settings → Developer settings → Personal access tokens.
Permission needed: **Contents: Read and write** (fine-grained) or `repo`
scope (classic). Copy the token now — it's shown once.

### 2. Configure the fallback repo (optional if you'll add repos in-app)

In `wrangler.jsonc`, update:

```jsonc
"vars": {
  "GITHUB_OWNER": "your-github-username",
  "GITHUB_REPO": "your-repo-name",
  "GITHUB_BRANCH": "main"
}
```

This is now just the **fallback** used until you add and activate a repo
from Settings → Repo Manager in the app itself. Once you've added at least
one repo in-app, these vars are no longer read.

### 3. Set secrets

```bash
npm install -g wrangler   # if you don't have it
wrangler login

wrangler secret put GITHUB_TOKEN
# paste the token from step 1

wrangler secret put ACCESS_PASSWORD
# choose a password — this is what you log into the tool with
```

### 4. KV namespaces

Two KV namespaces are used. Both are optional in the sense that the Worker
still runs without them, but you'll want both for anything beyond a single
quick deployment:

```bash
wrangler kv namespace create RATE_LIMIT
wrangler kv namespace create CONFIG
```

Paste the `id` each command prints into the matching entry under
`kv_namespaces` in `wrangler.jsonc`.

- **`RATE_LIMIT`** — brute-force lockout on the login password. 5 wrong
  passwords from one IP triggers a 30-second block; each wrong attempt after
  that doubles the wait, up to 15 minutes. A correct password resets the
  counter. Without this binding the Worker skips the lockout check entirely
  (the frontend's own countdown is just UX — it can't stop a script hitting
  the Worker directly, so this is worth doing for anything public-facing).
- **`CONFIG`** — stores the multi-repo registry (active repo, saved repo
  list, and the "show repo on login" setting) so it survives redeploys and
  can be changed at runtime from Settings instead of editing
  `wrangler.jsonc`. Without this binding, the app falls back to the single
  repo in `GITHUB_OWNER`/`GITHUB_REPO`/`GITHUB_BRANCH` and can't save
  additional repos — Settings → Repo Manager will show an error if you try
  to add one.

### 5. Deploy

```bash
npm install
wrangler deploy
```

Wrangler prints a `*.workers.dev` URL — that's your file manager. Open it,
enter the password from step 3, and you're in.

### 6. Add and switch repos (optional)

Once logged in, open **Settings** (gear icon in the header) → your first
repo (from `wrangler.jsonc`, if configured) shows as Active automatically.
From there:

- **Browse tab** — searches every repo your token can see; click **+ Add**
  on any result.
- **Manual tab** — type an `owner`/`repo` (and optionally a branch — leave
  it blank to auto-detect the repo's default branch) and click **Verify &
  Add**. This is also what checks your token actually has access before
  saving anything.
- Switch the active repo any time from the repo list. If you have
  uncommitted staged changes, switching asks you to confirm first — nothing
  is lost from GitHub's side either way, since staged changes were never
  committed, but the local staging state is cleared on switch.

### 7. Install it as an app

Once deployed and opened once over HTTPS, most browsers will offer an
**Install** button right in the header (and on the login screen). Tap it and
the tool opens like a native app from then on — its own icon, its own
window, no address bar, no re-typing the URL.

- **Android / desktop Chrome or Edge**: the Install button appears
  automatically once the browser is satisfied the app qualifies (usually
  within a few seconds of the first load).
- **iOS Safari**: iOS has no install-prompt API, so there's no button — open
  the **Share** menu (the square with an arrow) and choose **"Add to Home
  Screen."** The app shows this tip once automatically the first time it's
  opened in Safari.

## Notes

- **"Remember me" on login** stores the password in `localStorage` in
  plaintext. It's opt-in and meant for your own device only — the login
  form says as much when you check the box. Leave it unchecked on any
  shared or public machine (the password then only lives in
  `sessionStorage` for that tab, as before).
- Files over ~200 KB that aren't recognized as text open in a "no preview"
  state in the editor panel rather than trying to load a huge blob into a
  `<textarea>`.
- Find-in-file is deliberately simple: case-insensitive substring only, no
  regex. It's meant for quickly locating a string in the file you're
  already looking at, not as a general search tool.
