# Repo Manager

A full file manager for your GitHub repos — folder tree, inline text/code
editor with find-in-file, image preview, drag-and-drop moves, zip
upload/download, and multi-repo switching, all from one page. Deploys as a
single Cloudflare Worker; the GitHub token stays server-side (a Worker
secret) and never reaches the browser. Fully usable on mobile, not just
desktop — with a dedicated bottom-nav mobile layout, not just a squeezed
desktop view.

## What's new in this rebuild

**Architecture** — the whole app moved from one 1,900-line `app.js` and one
giant `index.html` into small, single-purpose modules (see "How it's laid
out" below). Nothing about how the app behaves for existing users changed
because of this — it's a maintainability rewrite, not a feature swap — but
it made the features below much easier to add safely.

**Security hardening**
- Constant-time password comparison on the login check (no timing
  side-channel on the access password).
- Server-side brute-force lockout backed by the `RATE_LIMIT` KV namespace —
  the earlier client-side-only countdown couldn't stop a script hitting the
  Worker directly; now it can't get past 5 attempts without a real,
  server-enforced, exponentially growing delay.
- Path-traversal and owner/repo-name validation on every write endpoint
  (`/api/commit`, `/api/repos`), as defense-in-depth behind the UI.
- Every response — API and static — carries `X-Content-Type-Options`,
  `X-Frame-Options`, and a restrictive `Content-Security-Policy` frame
  directive.
- The login screen flags plain-HTTP access (outside localhost) since a
  password would otherwise be sent in the clear.

**Mobile is a real first-class surface**, not a squeezed desktop layout:
- A bottom navigation bar (Files / Search / New / Changes / Settings) —
  the staged-changes count shows as a badge on "Changes."
- Folder tree opens as a slide-in drawer (hamburger button, edge-swipe,
  backdrop tap, and the Android/iOS back gesture all close it); on tablet
  widths it's a partial-width overlay, on phone widths it's near-full-width.
- File rows switch to a card layout with a subtitle line and always-visible
  40px+ touch targets — no hover-only actions you can't reach with a finger.
- Row actions collapse into a "⋮" that opens a bottom-sheet action menu
  (same actions as the desktop right-click menu); long-press also opens it.
- The "+New" menu becomes a bottom sheet (New folder / New file / Upload).
- Header folds Refresh and Sign out into an overflow (⋮) menu to cut
  clutter down to the essentials.
- Three responsive tiers instead of one cutoff: mobile (≤640px), tablet
  (641–1024px), desktop (>1024px) — see `public/styles/responsive.css`.

**Zip handling got smarter**
- Dropping a `.zip` no longer silently auto-extracts. A decision modal
  shows the file count and total size, then asks: **Unzip & merge into
  this folder**, or **keep it as a `.zip` file** (staged as-is, useful for
  release archives, backups, or anything you don't want exploded into
  individual files). Multiple zips dropped together are handled one at a
  time, in order.
- Large zips (20+ files) show live "Extracting N/M…" progress.
- Files inside a zip that exceed GitHub's 100MB blob limit are skipped
  individually (with a toast per skipped file) instead of failing the
  whole extraction.

**Downloads got a matching split**
- The old single "Download as zip" button is now a split button: the
  primary action zips the selection as before; the dropdown adds
  **"Download files individually"** (each file as its own browser
  download — folder structure isn't preserved this way, and the UI says
  so).
- Selecting exactly one file (not a folder, not multiple files) downloads
  that file directly in its original format — no zip wrapper — matching
  how Google Files / Windows Explorer behave.

**File size limits are enforced, not just discovered on failure**
- Client-side: any upload (drag-drop, file picker, or zip contents) is
  checked against GitHub's 100MB hard blob limit before it's staged — files
  over the limit are rejected with a clear toast instead of failing
  silently at commit time. Files between 50–100MB get a "large file" warning
  but are still staged. Oversized files also get a visible warning badge
  in the file list and the staged-changes drawer.
- Server-side: `/api/commit` re-checks every addition's size as
  defense-in-depth, in case the client-side check was bypassed.

**Everything from the previous version is still here**: multi-repo add/
switch/browse, the settings modal, inline editor with find-in-file
(`Ctrl/Cmd+F`) and save (`Ctrl/Cmd+S`), image preview, staged-changes drawer
with diff view, drag-and-drop moves, resizable desktop panels, "remember me"
login, Caps Lock warning, and PWA installability.

## How it's laid out

```
src/                      Cloudflare Worker (backend)
  index.js                thin router — no business logic, just dispatch + auth/rate-limit gate
  lib/                     json.js, concurrency.js, github.js, config.js
  middleware/              auth.js (timing-safe compare), rateLimit.js
  validators/               fileLimits.js, paths.js
  routes/                  one file per API route

public/
  index.html               markup only
  styles/                  one CSS file per UI area, plus responsive.css for breakpoints
  scripts/
    main.js                 entry point — wires every module together
    state.js, api.js
    auth/                   login.js, lockout.js
    tree/                   treeIndex.js, sidebar.js, breadcrumb.js
    file-list/              fileList.js, selection.js, contextMenu.js, rowActions.js, newItem.js
    editor/                 editor.js, find.js
    zip/                    zipUpload.js (decision modal), zipExtract.js, zipDownload.js,
                             resolveSelection.js, splitDownloadButton.js
    staging/                stage.js, stageDrawer.js, commitBar.js
    repoManager/            repoManager.js
    dragdrop/               dropzone.js, moveDialog.js
    layout/                 resizablePanels.js, mobileDrawer.js, bottomNav.js, headerOverflow.js
    pwa/                    install.js
    utils/                  dom.js, format.js, base64.js, toast.js, concurrency.js,
                             breakpoints.js, fileTypes.js, icons.js, sizeLimits.js, prompt.js
```

Each module exports a `setXHandler(fn)` function for any callback it needs
from elsewhere, instead of importing across features directly — `main.js` is
the only file that wires them all together, so no two feature modules
depend on each other's internals.

## How it works

- API routes on the Worker:
  - `GET /api/tree` — lists every file in the active repo
  - `POST /api/commit` — any mix of add/delete/rename/move, pushed as a
    single commit via GitHub's Git Data API (validates paths and file sizes
    server-side before touching GitHub)
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
- Zip extraction/creation happens client-side via the `fflate` library — the
  Worker only ever receives the individual files you've actually staged
  (or, if you chose "keep as .zip", the zip file itself as a single blob) —
  never a zip it has to unpack itself.
- The Worker has its own password (`ACCESS_PASSWORD`) — without it, nobody
  can call `/api/*` (except the intentionally-open `/api/meta`, which never
  returns anything beyond the repo name). A timing-safe comparison and a
  server-side rate limit protect this check.
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

- **`RATE_LIMIT`** — brute-force lockout on the login password, enforced
  server-side. 5 wrong passwords from one IP triggers a 30-second block;
  each wrong attempt after that doubles the wait, up to 15 minutes. A
  correct password resets the counter. Without this binding the Worker
  skips the lockout check entirely (the frontend's own countdown is just
  UX and can't stop a direct API call on its own — this binding is what
  makes the limit real, so it's worth setting up for anything
  public-facing).
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

Once logged in, open **Settings** (gear icon in the header, or the
Settings tab on mobile) → your first repo (from `wrangler.jsonc`, if
configured) shows as Active automatically. From there:

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
- The 100MB per-file limit comes directly from GitHub's Git Data API — it
  isn't a limit this app invented, and there's no way to raise it short of
  using Git LFS (which this tool doesn't manage).
- English-only UI throughout.
