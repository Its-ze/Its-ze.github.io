# ITSZ / Its-ze GitHub Hub

Static GitHub Pages site for `Its-ze.github.io`.

## What it does

- Shows a public "about me" landing page for the ITSZ / Its-ze GitHub profile.
- Fetches live public GitHub profile, repo, and event data in the browser.
- Falls back to checked-in `data/profile.json` and `data/repos.json` if GitHub rate-limits or is unavailable.
- Links verified sibling GitHub Pages sites from `data/pages.json`.
- Calculates recent public activity and a 12-week cadence bar chart.
- Provides searchable and filterable cards for every public repository.

## Local preview

```powershell
node .\tools\serve.mjs
```

Then open `http://127.0.0.1:8787/`.

## Publish

Create the public repository `Its-ze.github.io`, then push this folder to `main`.
The included workflow publishes through GitHub Pages Actions.
