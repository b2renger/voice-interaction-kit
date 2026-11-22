# Publishing the kit on GitHub

This folder is ready to become a public GitHub repository. Once it's on GitHub:

- every push to `main`, and every pull request, runs the automated tests (`.github/workflows/tests.yml`);
- every version tag (`v1.0.0`, `v1.1.0`…) builds the VIK installers for **Windows** and **Apple Silicon Macs**, and publishes them in a **GitHub Release** that students can download (`.github/workflows/release.yml`).

You need [Git](https://git-scm.com/downloads) and a GitHub account. The [GitHub CLI](https://cli.github.com/) (`gh`) makes step 2 one command, but it's optional.

## 0. Put the two workflows in place (only if you see a `github-workflows` folder)

GitHub only runs workflows stored in `.github/workflows/`. If this folder contains a `github-workflows` folder instead (Claude copied the files there because it isn't allowed to write into `.github` on your computer), move it once, from this folder:

```powershell
# Windows (PowerShell)
New-Item -ItemType Directory -Force .github | Out-Null; Move-Item github-workflows .github\workflows
```

```bash
# Mac / Linux
mkdir -p .github && mv github-workflows .github/workflows
```

You should then have `.github/workflows/release.yml` and `.github/workflows/tests.yml`.

## 1. Make the first commit

In a terminal, inside this folder (`vocal_interaction`):

```bash
git init -b main
git add -A
git commit -m "Voice Interaction Kit: cables.gl op (Gemini Live) and VIK (local, QVAC)"
```

Git uses your own name and email for the commit. If it complains that they are not set, run
`git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"` first.
To keep your email private on a public repository, use the `…@users.noreply.github.com` address shown in GitHub → Settings → Emails.

## 2. Create the public repository and push

With the GitHub CLI:

```bash
gh auth login                       # once
gh repo create voice-interaction-kit --public --source . --push
```

Or on the website: **New repository** → name it (e.g. `voice-interaction-kit`), **Public**, no README or license (the folder has them) → **Create**. Then, with the URL GitHub shows:

```bash
git remote add origin https://github.com/<your-account>/voice-interaction-kit.git
git push -u origin main
```

The **Tests** workflow starts right away (Actions tab).

## 3. Publish a release with the installers

```bash
git tag v1.0.0
git push origin v1.0.0
```

The **Release** workflow builds the Windows installer on a Windows machine and the Mac installer on an Apple Silicon Mac (GitHub provides both, free for public repositories), then creates the **v1.0.0** release with:

| file | for |
|---|---|
| `VIK-Setup-1.0.0-windows-x64.exe` | Windows installer |
| `VIK-1.0.0-windows-x64.zip` | Windows, portable (no installation) |
| `VIK-1.0.0-mac-arm64.dmg` | Mac installer (M1 and later) |
| `VIK-1.0.0-mac-arm64.zip` | Mac, the app in a zip |

It takes about 25–35 minutes. Nothing is published unless every test suite passes (the **Tests** workflow runs first) and each packaged app starts and runs (`app/scripts/smoke-package.mjs`: the server answers, the studio's page loads its agents). A tag with a dash (`v3.8.0-rc.1`) makes a pre-release, which the installed VIKs never update to. Students then download from the repository's **Releases** page.

For a new version: change what you want, commit, push, then tag `v1.0.1` (or `v1.1.0`) and push the tag. The tag sets the app's version number.

**The installed VIKs update themselves on Windows.** The release also carries `RELEASES` and `vik-<version>-full.nupkg`: a VIK installed with `VIK-Setup` finds them within the hour (through update.electronjs.org, a free service that reads public GitHub releases), downloads them and offers to restart. Leave both files in the release, under their names. A Mac VIK says a new version is out, with a link. The version number must go up (`v3.2.0` after `v3.1.0`): updates only go forward.

**What that means: a release reaches every installed Windows VIK.** This is by design: students get fixes without doing anything. It also makes this repository the one thing those computers trust. VIK is not code-signed, so nothing but GitHub stands between a release and the computers that install it within the hour.

- Protect the GitHub account that can publish here: two-factor sign-in on, and few people with write access.
- Try a build before releasing it (Actions tab → **Release** → **Run workflow**, below): what is released is installed everywhere, and updates only go forward.
- The release is published by a workflow of this repository (`.github/workflows/release.yml`), which uses an action written by someone else (`softprops/action-gh-release`) with the right to write releases. It is named by its version (`@v2`); naming it by an exact commit instead means a change to that action cannot reach a release unseen.
- A computer that must not update itself: `"updates": false` in its `config.json`.

To check a real Windows update without publishing anything: Actions tab → **Update test** → **Run workflow**. It builds two test versions, installs the first and checks that it updates itself to the second.

To build the installers **without** publishing a release (to try them first): Actions tab → **Release** → **Run workflow**. The files appear under "Artifacts" on the run page.

## Good to know

- **The installers are not code-signed.** Windows SmartScreen and macOS Gatekeeper warn on first launch. The release page and `docs/GUIDE.md` explain how to open them. Signing needs paid Apple and Windows certificates, which can be added to the workflow later.
- **No secret is in the repository.** The Gemini key lives in each student's browser (never in the patch) or in `cables/token-server/.env`, which `.gitignore` excludes. Double-check with `git status` before your first push that no `.env` file is listed.
- **The Smart Turn model** (8.7 MB, BSD-2) is part of the repository on purpose: VIK works without downloading it.
- **QVAC moves fast** (several breaking releases in 2026). `app/package.json` pins the SDK version: upgrade between terms, run `npm run selftest` on a Windows PC and a Mac, then tag a new release.
- **The lockfiles** (`package-lock.json`, `app/package-lock.json`) fix every dependency's version: the tests and the releases install exactly them (`npm ci`). After changing a `package.json`, regenerate its lockfile from a folder with no `node_modules` (copy the `package.json` to an empty folder, `npm install --package-lock-only`, copy the lockfile back): made next to an existing `node_modules`, it can miss the other platform's packages.
- **Licenses:** the kit is MIT (`LICENSE`); third-party parts keep theirs (`THIRD_PARTY_NOTICES.md`).
