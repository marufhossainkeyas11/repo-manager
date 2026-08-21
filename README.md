# Repo Manager

A full file manager for one specific GitHub repo — folder tree, inline text/code
editor, image preview, drag-and-drop moves, and zip upload that unpacks into
whatever folder you're browsing. Deploys as a single Cloudflare Worker; the
GitHub token stays server-side (a Worker secret) and never reaches the browser.

## What's new in this rebuild

- **Folder tree sidebar** (left) + file list (right), VS Code style, instead of
  one flat file list.
- **Zip upload respects the current folder.** Browse into `movies/`, drop a zip
  there, and its internal structure unpacks under `movies/...` — same as any
  other upload, it just preserves the zip's own folders instead of landing as
  one flat file.
- **New folder / new file** — new files open straight in the editor; empty
  folders get a small `.gitkeep` so Git tracks them.
- **Inline editor** for text/code files (`.js`, `.json`, `.md`, `.css`, etc.),
  **image preview** on click for `.png/.jpg/.svg/...`, and a plain "no preview"
  state for anything else (binary, video, etc.) — those still delete/move/rename
  fine, just no in-browser view.
- **Rename, duplicate, delete, and drag-and-drop move** for both files and
  folders. Renaming or moving a folder re-stages every file inside it.
- **Staged changes drawer** at the bottom — every add/delete/move queues up
  with a compact diff view (`+added`, `−deleted`, `⇄moved`) before you write a
  commit message and push it all as one commit.
- **Settings panel** showing the connected repo, branch, and visibility.
- **Installable as an app (PWA)** — an "Install" button appears (desktop
  Chrome/Edge, Android Chrome) once the browser decides the app qualifies;
  iOS Safari gets a one-time hint pointing at Share → Add to Home Screen,
  since iOS has no install-prompt API. Installed, it opens in its own
  window/icon with no browser chrome — no more re-typing the URL.
- English-only UI throughout.

## How it works

- Two API routes on the Worker: `GET /api/tree` (lists every file in the repo)
  and `POST /api/commit` (any mix of add/delete/rename/move, pushed as a single
  commit via GitHub's Git Data API). Two small additions: `GET /api/blob`
  (fetches one file's content for the editor/preview) and `GET /api/repo`
  (repo metadata for the header/settings panel).
- The frontend is one static page (`public/index.html` + `public/app.js`). Zip
  extraction happens client-side via the `fflate` library — the Worker only
  ever receives the individual files you've actually staged, never the zip
  itself.
- The Worker has its own password (`ACCESS_PASSWORD`) — without it, nobody can
  call `/api/*`.
- A small service worker (`public/sw.js`) caches only the static shell
  (HTML/JS/icons) for instant loads and installability — it never caches
  `/api/*` responses, so the file tree, blobs, and commits are always live.

## Setup

### 1. Create a fine-grained GitHub Personal Access Token

GitHub → Settings → Developer settings → Personal access tokens →
**Fine-grained tokens** → Generate new token

- **Repository access**: select only the one repo (not all repos)
- **Permissions**: only **Contents: Read and write** — nothing else needed
- Copy the token now (it's shown once)

This token only works on that one repo, not your whole account — the safest
option.

### 2. Configure

In `wrangler.jsonc`, update:

```jsonc
"vars": {
  "GITHUB_OWNER": "your-github-username",
  "GITHUB_REPO": "your-repo-name",
  "GITHUB_BRANCH": "main"
}
```

(Already pointed at `marufhossainkeyas11/Cookie-Vault-Bookmark` — change if needed.)

### 3. Set secrets

```bash
npm install -g wrangler   # if you don't have it
wrangler login

wrangler secret put GITHUB_TOKEN
# paste the token from step 1

wrangler secret put ACCESS_PASSWORD
# choose a password — this is what you log into the tool with
```

### 4. (Optional but recommended) Turn on brute-force lockout

To temporarily block an IP that keeps guessing the wrong password, create a KV
namespace:

```bash
wrangler kv namespace create RATE_LIMIT
```

Paste the `id` it gives you into the `kv_namespaces` section of
`wrangler.jsonc`. The Worker runs fine without this step too — it just skips
the lockout check, so it's worth doing for production.

How the lockout works: 5 wrong passwords from one IP triggers a 30-second
block; each wrong attempt after that doubles the wait, up to 15 minutes. A
correct password resets the counter. The frontend also shows a countdown, but
the real protection is this server-side KV check — the frontend countdown
can't stop a script hitting the Worker directly.

### 5. Deploy

```bash
npm install
wrangler deploy
```

Wrangler prints a `*.workers.dev` URL — that's your file manager. Open it,
enter the password from step 3, and you're in.

### 6. Install it as an app

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

- This Worker is scoped to one repo, matching the token's own scope. Managing
  multiple repos would mean multiple deployments (or multiple tokens/vars),
  which wasn't the shape asked for here — flag it if that changes and it's a
  small extension of the same `github.js` layer.
- Files over ~200 KB that aren't recognized as text open in a "no preview"
  state in the editor panel rather than trying to load a huge blob into a
  `<textarea>`.
