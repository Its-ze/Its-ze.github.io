import { readFile, writeFile } from "node:fs/promises";

const USER = process.env.HUB_GITHUB_USER || process.env.GITHUB_REPOSITORY_OWNER || "Its-ze";
const HUB_REPO = (process.env.HUB_REPO_NAME || `${USER}.github.io`).toLowerCase();
const API_BASE = process.env.GITHUB_API_URL || "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const githubHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "its-ze-github-pages-hub"
};

if (TOKEN) {
  githubHeaders.Authorization = `Bearer ${TOKEN}`;
}

const dataFiles = {
  profile: "data/profile.json",
  repos: "data/repos.json",
  pages: "data/pages.json"
};

const pageProbeTimeoutMs = Number(process.env.PAGE_PROBE_TIMEOUT_MS || 12000);

async function main() {
  const existingPages = await readJson(dataFiles.pages, []);
  const existingPageOrder = new Map(existingPages.map((page, index) => [page.repo, index]));
  const existingPageByRepo = new Map(existingPages.map((page) => [page.repo, page]));

  const profile = await githubJson(`/users/${USER}`);
  const repos = await fetchAllRepos();
  const pages = await discoverPages(repos, existingPageByRepo, existingPageOrder);

  await writeJson(dataFiles.profile, pickProfile(profile));
  await writeJson(dataFiles.repos, repos.map(pickRepo));
  await writeJson(dataFiles.pages, pages);

  console.log(`Refreshed ${repos.length} repos and ${pages.length} linked Pages sites for ${USER}.`);
}

async function fetchAllRepos() {
  const repos = [];

  for (let page = 1; ; page += 1) {
    const batch = await githubJson(`/users/${USER}/repos?per_page=100&page=${page}&sort=updated&type=owner`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
  }

  return repos.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

async function discoverPages(repos, existingPageByRepo, existingPageOrder) {
  const pages = [];

  for (const repo of repos) {
    if (isHubRepo(repo.name)) continue;

    const candidates = await pageCandidatesFor(repo);
    const liveCandidate = await firstLiveCandidate(candidates);
    if (!liveCandidate) continue;

    const existing = existingPageByRepo.get(repo.name) || {};
    pages.push({
      repo: repo.name,
      title: existing.title || titleFromRepo(repo.name),
      url: liveCandidate.url,
      repoUrl: repo.html_url,
      label: existing.label || labelForPage(repo, liveCandidate),
      description: existing.description || repo.description || `Public site for ${titleFromRepo(repo.name)}.`,
      status: statusForPage(liveCandidate)
    });
  }

  return pages.sort((a, b) => {
    const aOrder = existingPageOrder.has(a.repo) ? existingPageOrder.get(a.repo) : Number.MAX_SAFE_INTEGER;
    const bOrder = existingPageOrder.has(b.repo) ? existingPageOrder.get(b.repo) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.title.localeCompare(b.title);
  });
}

async function pageCandidatesFor(repo) {
  const candidates = [];
  const seen = new Set();

  for (const url of await customDomainCandidates(repo)) {
    pushCandidate(candidates, seen, { url, kind: "custom" });
  }

  if (repo.homepage && likelyPagesUrl(repo.homepage)) {
    pushCandidate(candidates, seen, { url: normalizeUrl(repo.homepage), kind: "homepage" });
  }

  if (repo.name.toLowerCase().endsWith(".github.io")) {
    pushCandidate(candidates, seen, { url: `https://${repo.name}/`, kind: "user-site" });
  } else {
    pushCandidate(candidates, seen, { url: `https://${USER.toLowerCase()}.github.io/${repo.name}/`, kind: "project-site" });
  }

  return candidates;
}

async function customDomainCandidates(repo) {
  const branch = repo.default_branch || "main";
  const tree = await githubJson(`/repos/${USER}/${encodeURIComponent(repo.name)}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
    allow404: true
  });

  if (!tree?.tree) return [];

  const cnamePaths = tree.tree
    .filter((item) => item.type === "blob")
    .map((item) => item.path)
    .filter((path) => path.split("/").pop()?.toUpperCase() === "CNAME")
    .filter((path) => !path.includes("node_modules/"))
    .slice(0, 8);

  const domains = [];
  for (const path of cnamePaths) {
    const rawUrl = `https://raw.githubusercontent.com/${USER}/${repo.name}/${branch}/${path}`;
    const text = await fetchText(rawUrl, { allow404: true });
    const domain = text?.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (domain && /^[a-z0-9.-]+$/i.test(domain)) {
      domains.push(`https://${domain}/`);
    }
  }

  return domains;
}

async function firstLiveCandidate(candidates) {
  for (const candidate of candidates) {
    if (await isLivePage(candidate.url)) return candidate;
  }
  return null;
}

async function isLivePage(url) {
  try {
    const response = await timedFetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "its-ze-github-pages-hub" }
    });

    if (!response.ok) return false;

    const text = await response.text();
    return !text.includes("There isn't a GitHub Pages site here.");
  } catch {
    return false;
  }
}

async function githubJson(path, options = {}) {
  const response = await timedFetch(`${API_BASE}${path}`, { headers: githubHeaders });

  if (options.allow404 && response.status === 404) return null;

  if (!response.ok) {
    throw new Error(`GitHub API ${path} returned ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await timedFetch(url, {
    headers: { "User-Agent": "its-ze-github-pages-hub" },
    redirect: "follow"
  });

  if (options.allow404 && response.status === 404) return null;

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.text();
}

async function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), pageProbeTimeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function pickProfile(profile) {
  return {
    login: profile.login,
    name: profile.name,
    bio: profile.bio,
    html_url: profile.html_url,
    avatar_url: profile.avatar_url,
    public_repos: profile.public_repos,
    followers: profile.followers,
    following: profile.following,
    created_at: profile.created_at,
    updated_at: profile.updated_at
  };
}

function pickRepo(repo) {
  return {
    name: repo.name,
    html_url: repo.html_url,
    description: repo.description,
    language: repo.language,
    stargazers_count: repo.stargazers_count,
    forks_count: repo.forks_count,
    updated_at: repo.updated_at,
    homepage: repo.homepage || null,
    topics: repo.topics || []
  };
}

function pushCandidate(candidates, seen, candidate) {
  const url = normalizeUrl(candidate.url);
  if (!url || seen.has(url)) return;
  seen.add(url);
  candidates.push({ ...candidate, url });
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    if (!url.pathname) url.pathname = "/";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.toString();
  } catch {
    return "";
  }
}

function likelyPagesUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.endsWith(".github.io") || url.hostname.includes("itsolutions.digital");
  } catch {
    return false;
  }
}

function isHubRepo(name) {
  return name.toLowerCase() === HUB_REPO || name.toLowerCase() === `${USER.toLowerCase()}.github.io`;
}

function titleFromRepo(name) {
  return name
    .replace(/\.github\.io$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function labelForPage(repo, candidate) {
  if (candidate.kind === "custom") return "Custom domain";
  if (repo.name.toLowerCase().endsWith(".github.io")) return "Pages site";
  return "GitHub Pages";
}

function statusForPage(candidate) {
  if (candidate.kind === "custom") return "GitHub Pages custom domain";
  return "Live GitHub Pages";
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
