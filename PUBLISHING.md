# Publishing the kit on GitHub

This folder is ready to become a public GitHub repository. Once it's on GitHub:

- every push to `main`, and every pull request, runs the automated tests (`.github/workflows/tests.yml`);
- every version tag (`v1.0.0`, `v1.1.0`…) builds the Voice Lab installers for **Windows** and **Apple Silicon Macs**, and publishes them in a **GitHub Release** that students can download (`.github/workflows/release.yml`).

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
git commit -m "Voice interaction kit: cables.gl op (Gemini Live) and Voice Lab (local, QVAC)"
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
| `VoiceLab-Setup-1.0.0-windows-x64.exe` | Windows installer |
| `VoiceLab-1.0.0-windows-x64.zip` | Windows, portable (no installation) |
| `VoiceLab-1.0.0-mac-arm64.dmg` | Mac installer (M1 and later) |
| `VoiceLab-1.0.0-mac-arm64.zip` | Mac, the app in a zip |

It takes about 15–25 minutes. Students then download from the repository's **Releases** page.

For a new version: change what you want, commit, push, then tag `v1.0.1` (or `v1.1.0`) and push the tag. The tag sets the app's version number.

To build the installers **without** publishing a release (to try them first): Actions tab → **Release** → **Run workflow**. The files appear under "Artifacts" on the run page.

## Good to know

- **The installers are not code-signed.** Windows SmartScreen and macOS Gatekeeper warn on first launch. The release page and `docs/GUIDE.md` explain how to open them. Signing needs paid Apple and Windows certificates, which can be added to the workflow later.
- **No secret is in the repository.** The Gemini key lives in each student's browser (never in the patch) or in `1_cables_gemini_live/token-server/.env`, which `.gitignore` excludes. Double-check with `git status` before your first push that no `.env` file is listed.
- **The Smart Turn model** (8.7 MB, BSD-2) is part of the repository on purpose: Voice Lab works without downloading it.
- **QVAC moves fast** (several breaking releases in 2026). `2_qvac_local/package.json` pins the SDK version: upgrade between terms, run `npm run selftest` on a Windows PC and a Mac, then tag a new release.
- **Licenses:** the kit is MIT (`LICENSE`); third-party parts keep theirs (`THIRD_PARTY_NOTICES.md`).
