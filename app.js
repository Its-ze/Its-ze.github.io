const USER = "Its-ze";
const profileUrl = `https://api.github.com/users/${USER}`;
const reposUrl = `https://api.github.com/users/${USER}/repos?per_page=100&sort=updated`;
const eventsUrl = `https://api.github.com/users/${USER}/events/public?per_page=100`;

const state = {
  profile: null,
  repos: [],
  events: [],
  filter: "all",
  query: ""
};

const categoryRules = [
  { key: "hardware", terms: ["deck", "flasher", "firmware", "sdr", "rtl", "radio", "pager", "pineapple", "esp32", "cyberdeck"] },
  { key: "apps", terms: ["studio", "viewer", "editor", "app", "game"] },
  { key: "web", terms: ["github.io", "web", "html", "pages", "browser"] },
  { key: "tools", terms: ["tool", "scrub", "encrypt", "scanner", "utility", "python", "shell"] }
];

const tagRules = [
  { tag: "firmware", terms: ["firmware", "flasher", "z-deck", "zdeck"] },
  { tag: "hardware", terms: ["deck", "pager", "sdr", "rtl", "esp32", "radio"] },
  { tag: "creative", terms: ["studio", "photo", "viewer", "editor"] },
  { tag: "web", terms: ["github.io", "html", "browser", "web"] },
  { tag: "utility", terms: ["scrub", "encrypt", "tool", "utility"] },
  { tag: "game", terms: ["game", "fun"] }
];

const languageColors = {
  HTML: "#ff5f57",
  TypeScript: "#2dd4bf",
  Python: "#9f7aea",
  JavaScript: "#ffbf3f",
  Shell: "#64d96a",
  Unknown: "#b8bcc8"
};

document.addEventListener("DOMContentLoaded", () => {
  bindControls();
  hydrate();
});

async function hydrate() {
  const [profile, repos, events] = await Promise.all([
    fetchJson(profileUrl, "data/profile.json"),
    fetchJson(reposUrl, "data/repos.json"),
    fetchOptionalJson(eventsUrl)
  ]);

  state.profile = profile;
  state.repos = repos.map(normalizeRepo).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  state.events = Array.isArray(events) ? events : [];

  renderProfile();
  renderPulse();
  renderRepos();
  renderIcons();
}

async function fetchJson(liveUrl, fallbackUrl) {
  try {
    const response = await fetch(liveUrl, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    return response.json();
  } catch (error) {
    const response = await fetch(fallbackUrl, { cache: "no-store" });
    if (!response.ok) throw error;
    return response.json();
  }
}

async function fetchOptionalJson(url) {
  try {
    const response = await fetch(url, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

function bindControls() {
  const search = document.querySelector("#repo-search");
  const clearSearch = document.querySelector("#clear-search");
  search.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    clearSearch.disabled = !state.query;
    renderRepos();
  });

  clearSearch.addEventListener("click", () => {
    search.value = "";
    state.query = "";
    clearSearch.disabled = true;
    search.focus();
    renderRepos();
  });

  document.querySelectorAll(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll(".filter-button").forEach((item) => item.classList.toggle("is-active", item === button));
      renderRepos();
    });
  });
}

function normalizeRepo(repo) {
  const searchable = `${repo.name} ${repo.description || ""} ${repo.language || ""}`.toLowerCase();
  const category = categoryRules.find((rule) => rule.terms.some((term) => searchable.includes(term)))?.key || "tools";
  const tags = tagRules
    .filter((rule) => rule.terms.some((term) => searchable.includes(term)))
    .map((rule) => rule.tag)
    .slice(0, 4);

  return {
    ...repo,
    category,
    tags: tags.length ? tags : [category],
    language: repo.language || "Unknown"
  };
}

function renderProfile() {
  const profile = state.profile || {};
  const repos = state.repos;
  const now = new Date();
  const active90 = repos.filter((repo) => daysBetween(now, repo.updated_at) <= 90).length;
  const latest = repos[0]?.updated_at;

  setText("#profile-name", profile.name || profile.login || USER);
  setText("#profile-bio", profile.bio || "Hardware-leaning public projects, browser tools, app experiments, and release-ready utility work.");
  setText("#stat-repos", profile.public_repos ?? repos.length);
  setText("#stat-active-90", active90);
  setText("#stat-latest", latest ? relativeTime(latest) : "No data");

  const avatar = document.querySelector("#avatar");
  if (profile.avatar_url) avatar.src = profile.avatar_url;
}

function renderPulse() {
  const now = new Date();
  const recentEvents = state.events.filter((event) => daysBetween(now, event.created_at) <= 30);
  const recentRepos = state.repos.filter((repo) => daysBetween(now, repo.updated_at) <= 30);
  const active90 = state.repos.filter((repo) => daysBetween(now, repo.updated_at) <= 90);
  const language = mostCommon(state.repos.map((repo) => repo.language).filter((item) => item !== "Unknown")) || "Mixed";

  setText("#stat-events", state.events.length ? recentEvents.length : active90.length);
  setText("#stat-events-label", state.events.length ? "public events in the last 30 days" : "repos updated in the last 90 days");
  setText("#stat-language", language);
  setText("#stat-streak", recentRepos.length);
  setText("#activity-note", state.events.length
    ? "Live public GitHub events are feeding the pulse."
    : "GitHub events were unavailable, so repo update times are feeding the pulse.");

  renderWeeks(state.events.length ? state.events : state.repos, Boolean(state.events.length));
}

function renderWeeks(items, useEvents) {
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const start = startOfWeek(new Date());
    start.setDate(start.getDate() - (11 - index) * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start, end, count: 0 };
  });

  items.forEach((item) => {
    const date = new Date(useEvents ? item.created_at : item.updated_at);
    const bucket = buckets.find((entry) => date >= entry.start && date < entry.end);
    if (bucket) bucket.count += 1;
  });

  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const html = buckets.map((bucket) => {
    const height = 18 + Math.round((bucket.count / max) * 104);
    const label = `${bucket.start.getMonth() + 1}/${bucket.start.getDate()}`;
    const title = `${bucket.count} ${useEvents ? "events" : "repo updates"} during week of ${label}`;
    return `<div class="week-bar" style="height:${height}px" title="${escapeHtml(title)}"><span>${bucket.count}</span></div>`;
  }).join("");

  document.querySelector("#week-bars").innerHTML = html;
  setText("#timeline-source", useEvents ? "public events" : "repo update fallback");
}

function renderRepos() {
  const grid = document.querySelector("#repo-grid");
  const query = state.query;
  const filter = state.filter;

  const repos = state.repos.filter((repo) => {
    const matchesFilter = filter === "all" || repo.category === filter;
    const haystack = `${repo.name} ${repo.description || ""} ${repo.language} ${repo.tags.join(" ")}`.toLowerCase();
    return matchesFilter && (!query || haystack.includes(query));
  });

  setText("#repo-count", `${repos.length} of ${state.repos.length} public repos shown`);

  if (!repos.length) {
    grid.innerHTML = `<div class="empty-state">No public repos match that filter yet. Clear search or switch lanes.</div>`;
    return;
  }

  grid.innerHTML = repos.map((repo) => repoCard(repo)).join("");
  renderIcons();
}

function repoCard(repo) {
  const description = repo.description || "A public project from the ITSZ workspace.";
  const languageColor = languageColors[repo.language] || languageColors.Unknown;
  const homepage = repo.homepage ? `<a href="${escapeAttr(repo.homepage)}" target="_blank" rel="noreferrer"><i data-lucide="globe" aria-hidden="true"></i><span>Site</span></a>` : "";
  const tags = repo.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");

  return `
    <article class="repo-card" data-category="${escapeAttr(repo.category)}">
      <div class="repo-topline">
        <a class="repo-name" href="${escapeAttr(repo.html_url)}" target="_blank" rel="noreferrer">
          <i data-lucide="folder-git-2" aria-hidden="true"></i>
          <span>${escapeHtml(repo.name)}</span>
        </a>
        <span class="category-pill">${escapeHtml(labelFor(repo.category))}</span>
      </div>
      <p class="repo-description">${escapeHtml(description)}</p>
      <div class="repo-meta">
        <span><i class="language-dot" style="background:${languageColor}"></i>${escapeHtml(repo.language)}</span>
        <span>Updated ${escapeHtml(relativeTime(repo.updated_at))}</span>
        <span>${repo.stargazers_count || 0} stars</span>
      </div>
      <div class="repo-tags">${tags}</div>
      <div class="repo-actions">
        <a href="${escapeAttr(repo.html_url)}" target="_blank" rel="noreferrer"><i data-lucide="git-branch" aria-hidden="true"></i><span>Repo</span></a>
        ${homepage}
      </div>
    </article>
  `;
}

function labelFor(category) {
  return {
    hardware: "Hardware",
    apps: "App",
    web: "Web",
    tools: "Tool"
  }[category] || "Project";
}

function mostCommon(items) {
  const counts = new Map();
  items.forEach((item) => counts.set(item, (counts.get(item) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function startOfWeek(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function daysBetween(now, value) {
  return Math.floor((now - new Date(value)) / 86400000);
}

function relativeTime(value) {
  const days = daysBetween(new Date(), value);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function renderIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
