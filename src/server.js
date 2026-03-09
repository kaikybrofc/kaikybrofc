const path = require("node:path");
const dotenv = require("dotenv");
const express = require("express");
const simpleIcons = require("simple-icons");

const { fetchProfileSummary } = require("./github-profile");
const { updateReadmeWithSummary } = require("./readme-sync");

dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

const app = express();
const startedAt = new Date().toISOString();
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3015);
const readmePath = process.env.README_PATH || path.resolve(process.cwd(), "README.md");
const autoRefreshEnabled = (process.env.README_AUTO_REFRESH || "true").toLowerCase() === "true";
const autoRefreshIntervalMin = Number(process.env.README_REFRESH_INTERVAL_MIN || 60);
const profileCacheTtlSec = Number(process.env.PROFILE_CACHE_TTL_SEC || 300);
const badgeCacheTtlSec = Number(process.env.BADGE_CACHE_TTL_SEC || 120);
let lastSync = null;
let lastSyncError = null;
let cachedSummary = null;
let cachedSummaryAt = 0;
let cachedBadgeSummary = null;
let cachedBadgeSummaryAt = 0;
const BADGE_COLORS = Object.freeze({
  primary: "00e5ff",
  secondary: "38bdf8",
  info: "22d3ee",
  accent: "ff2bd6",
  success: "22c55e",
  violet: "a855f7",
  indigo: "8b5cf6",
  warning: "f59e0b",
  danger: "ef4444",
  label: "0b0f1a"
});
const CONTACT_BADGES = Object.freeze({
  github: { label: "GitHub", message: "kaikybrofc", color: BADGE_COLORS.primary },
  linkedin: { label: "LinkedIn", message: "kaiky-gomes", color: BADGE_COLORS.secondary },
  email: { label: "Email", message: "Contato", color: BADGE_COLORS.accent },
  whatsapp: { label: "WhatsApp", message: "+55 95 99122-954", color: BADGE_COLORS.success }
});
const STACK_BADGES = Object.freeze({
  javascript: { label: "Stack", message: "JavaScript", color: BADGE_COLORS.info },
  typescript: { label: "Stack", message: "TypeScript", color: BADGE_COLORS.secondary },
  nodejs: { label: "Stack", message: "Node.js", color: BADGE_COLORS.primary },
  express: { label: "Stack", message: "Express", color: BADGE_COLORS.indigo },
  react: { label: "Stack", message: "React", color: BADGE_COLORS.info },
  linux: { label: "Stack", message: "Linux", color: BADGE_COLORS.secondary },
  docker: { label: "Stack", message: "Docker", color: BADGE_COLORS.primary },
  mongodb: { label: "Stack", message: "MongoDB", color: BADGE_COLORS.info },
  mysql: { label: "Stack", message: "MySQL", color: BADGE_COLORS.secondary },
  redis: { label: "Stack", message: "Redis", color: BADGE_COLORS.accent }
});
const ICON_QUERY_ALIASES = Object.freeze({
  csharp: "sharp",
  shell: "gnubash",
  bash: "gnubash",
  zsh: "gnubash",
  powershell: "powers",
  nodejs: "nodedotjs",
  dockerfile: "docker",
  sql: "mysql",
  golang: "go",
  js: "javascript",
  ts: "typescript"
});
const SIMPLE_ICON_LIST = Object.values(simpleIcons).filter((icon) => {
  return (
    icon &&
    typeof icon === "object" &&
    typeof icon.title === "string" &&
    typeof icon.slug === "string" &&
    typeof icon.path === "string" &&
    typeof icon.hex === "string"
  );
});

app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));

async function getProfileSummary(options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  const ttlMs = Math.max(profileCacheTtlSec, 30) * 1000;

  if (!force && cachedSummary && now - cachedSummaryAt < ttlMs) {
    return cachedSummary;
  }

  const summary = await fetchProfileSummary();
  cachedSummary = summary;
  cachedSummaryAt = now;
  return summary;
}

async function getBadgeSummary(options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  const ttlMs = Math.max(badgeCacheTtlSec, 15) * 1000;

  if (!force && cachedBadgeSummary && now - cachedBadgeSummaryAt < ttlMs) {
    return cachedBadgeSummary;
  }

  const summary = await getProfileSummary({ force: true });
  cachedBadgeSummary = summary;
  cachedBadgeSummaryAt = now;
  return summary;
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(
    Number(value || 0)
  );
}

function formatRelativeTime(isoDate) {
  if (!isoDate) {
    return "sem dados";
  }

  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) {
    return "sem dados";
  }

  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (diffSec < 60) {
    return "agora";
  }

  if (diffSec < 3600) {
    return `${Math.floor(diffSec / 60)}m`;
  }

  if (diffSec < 86400) {
    return `${Math.floor(diffSec / 3600)}h`;
  }

  return `${Math.floor(diffSec / 86400)}d`;
}

function normalizeHexColor(color, fallback = "0ea5e9") {
  const raw = String(color || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.toLowerCase();
  }
  return fallback.toLowerCase();
}

function estimateTextWidth(text) {
  const length = String(text || "").length;
  return Math.max(66, Math.min(480, Math.round(length * 7.4 + 24)));
}

function normalizeIconLookup(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\+\+/g, "plusplus")
    .replace(/\+/g, "plus")
    .replace(/#/g, "sharp")
    .replace(/\./g, "dot")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

function buildIconLookupKeys(value) {
  const base = normalizeIconLookup(value);
  if (!base) {
    return [];
  }

  const variants = new Set([base, base.replace(/dot/g, "")]);
  return [...variants].filter(Boolean);
}

const SIMPLE_ICONS_BY_KEY = (() => {
  const map = new Map();
  for (const icon of SIMPLE_ICON_LIST) {
    const keys = [
      ...buildIconLookupKeys(icon.slug),
      ...buildIconLookupKeys(icon.title)
    ];

    for (const key of keys) {
      if (!map.has(key)) {
        map.set(key, icon);
      }
    }
  }

  for (const key of Object.keys(simpleIcons)) {
    if (!key.startsWith("si")) {
      continue;
    }

    const sanitized = buildIconLookupKeys(key.slice(2));
    for (const normalized of sanitized) {
      if (!map.has(normalized)) {
        map.set(normalized, simpleIcons[key]);
      }
    }
  }

  return map;
})();

function resolveSimpleIcon(query) {
  const normalized = normalizeIconLookup(query);
  if (!normalized) {
    return null;
  }

  const alias = ICON_QUERY_ALIASES[normalized];
  const candidates = [
    ...buildIconLookupKeys(normalized),
    ...buildIconLookupKeys(alias)
  ];

  for (const key of candidates) {
    const icon = SIMPLE_ICONS_BY_KEY.get(key);
    if (icon) {
      return icon;
    }
  }

  return null;
}

function pickContrastTextColor(hexColor) {
  const hex = normalizeHexColor(hexColor, BADGE_COLORS.primary);
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);

  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? "0b1020" : "ecfeff";
}

function resolveLanguageVisual(language) {
  const key = String(language || "").trim();

  if (!key || key.toLowerCase() === "n/a") {
    return {
      color: BADGE_COLORS.secondary,
      iconPath: null,
      iconTitle: ""
    };
  }

  const icon = resolveSimpleIcon(key);

  if (!icon) {
    return {
      color: BADGE_COLORS.info,
      iconPath: null,
      iconTitle: ""
    };
  }

  return {
    color: normalizeHexColor(icon.hex, BADGE_COLORS.info),
    iconPath: icon.path || null,
    iconTitle: icon.title || ""
  };
}

function renderBadgeSvg(definition) {
  const labelText = String(definition?.label || "badge");
  const messageText = String(definition?.message || "ok");
  const label = escapeXml(labelText);
  const message = escapeXml(messageText);
  const labelColor = normalizeHexColor(definition?.labelColor, BADGE_COLORS.label);
  const messageColor = normalizeHexColor(definition?.color, BADGE_COLORS.primary);
  const labelTextColor = normalizeHexColor(definition?.labelTextColor, "c8e9ff");
  const messageTextColor = normalizeHexColor(definition?.textColor, pickContrastTextColor(messageColor));
  const iconPath = String(definition?.iconPath || "").trim();
  const hasIcon = Boolean(iconPath);
  const iconColor = normalizeHexColor(definition?.iconColor, messageTextColor);
  const labelWidth = estimateTextWidth(labelText);
  const messageWidth = estimateTextWidth(messageText) + (hasIcon ? 24 : 0);
  const totalWidth = labelWidth + messageWidth;
  const separatorX = labelWidth;
  const scanWidth = Math.max(120, Math.round(totalWidth * 0.24));
  const messageTextX = Math.round(labelWidth + messageWidth / 2 + (hasIcon ? 8 : 0));
  const iconBoxX = labelWidth + 6;
  const iconTranslateX = labelWidth + 9;

  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${labelText}: ${messageText}" width="${totalWidth}" height="32" viewBox="0 0 ${totalWidth} 32">
  <defs>
    <linearGradient id="bgLabel" x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#${labelColor}"/>
      <stop offset="1" stop-color="#${labelColor}"/>
    </linearGradient>
    <linearGradient id="bgMessage" x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#${messageColor}"/>
      <stop offset="1" stop-color="#${messageColor}"/>
    </linearGradient>
    <linearGradient id="scan" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="capsule">
      <rect width="${totalWidth}" height="32" rx="8" ry="8"/>
    </clipPath>
    <filter id="glow" x="-30%" y="-200%" width="160%" height="500%">
      <feGaussianBlur stdDeviation="2.4"/>
    </filter>
  </defs>
  <g clip-path="url(#capsule)">
    <rect width="${labelWidth}" height="32" fill="url(#bgLabel)"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="32" fill="url(#bgMessage)"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="32" fill="#ffffff" opacity="0.08">
      <animate attributeName="opacity" dur="2.6s" repeatCount="indefinite" values="0.04;0.16;0.04"/>
    </rect>
    <rect x="-${scanWidth}" y="0" width="${scanWidth}" height="32" fill="url(#scan)">
      <animate attributeName="x" dur="3.6s" repeatCount="indefinite" values="-${scanWidth};${totalWidth}"/>
    </rect>
  </g>
  <line x1="${separatorX}" y1="4" x2="${separatorX}" y2="28" stroke="#94a3b8" stroke-opacity="0.45"/>
  <line x1="${separatorX}" y1="16" x2="${Math.min(totalWidth - 8, separatorX + 70)}" y2="16" stroke="#ffffff" stroke-opacity="0.4" stroke-width="2" filter="url(#glow)">
    <animate attributeName="opacity" dur="1.8s" repeatCount="indefinite" values="0.25;0.9;0.25"/>
  </line>
  ${
    hasIcon
      ? `<rect x="${iconBoxX}" y="7" width="18" height="18" rx="4" fill="#020617" fill-opacity="0.36" stroke="#ffffff" stroke-opacity="0.2"/>
  <g transform="translate(${iconTranslateX} 10) scale(0.58)">
    <path fill="#${iconColor}" d="${iconPath}"/>
  </g>`
      : ""
  }
  <text x="${Math.round(labelWidth / 2)}" y="21" text-anchor="middle" fill="#${labelTextColor}" font-family="JetBrains Mono, Consolas, monospace" font-size="11.4" font-weight="700" letter-spacing="0.35">${label}</text>
  <text x="${messageTextX}" y="21" text-anchor="middle" fill="#${messageTextColor}" font-family="JetBrains Mono, Consolas, monospace" font-size="11.4" font-weight="800" letter-spacing="0.25">${message}</text>
</svg>`;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildAnimatedHeroSvg(summary) {
  const fallback = {
    title: "KAIKY BRITO",
    subtitle: "PROFILE SYSTEM // NODE // AUTOMACAO // SEGURANCA"
  };

  const displayName = summary?.user?.name || summary?.user?.login || fallback.title;
  const login = summary?.user?.login ? `@${summary.user.login}` : "@profile";
  const publicRepos = Number(summary?.totals?.publicRepositories || 0);
  const topLanguage = summary?.languages?.[0]?.language || "N/A";
  const title = escapeXml(String(displayName).toUpperCase());
  const subtitle = escapeXml(
    `${login} // ${publicRepos} REPOS PUBLICOS // STACK: ${String(topLanguage).toUpperCase()}`
  );

  return `<svg width="1400" height="420" viewBox="0 0 1400 420" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Neon tech grid background animated">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1400" y2="420" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#030712"/>
      <stop offset="0.55" stop-color="#051a2f"/>
      <stop offset="1" stop-color="#0b1020"/>
    </linearGradient>
    <radialGradient id="glowA" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(180 70) rotate(15) scale(520 240)">
      <stop offset="0" stop-color="#00e5ff" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#00e5ff" stop-opacity="0"/>
      <animate attributeName="gradientTransform" dur="9s" repeatCount="indefinite" values="translate(180 70) rotate(15) scale(520 240);translate(250 90) rotate(10) scale(580 260);translate(180 70) rotate(15) scale(520 240)"/>
    </radialGradient>
    <radialGradient id="glowB" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1210 90) rotate(-15) scale(500 240)">
      <stop offset="0" stop-color="#ff2bd6" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#ff2bd6" stop-opacity="0"/>
      <animate attributeName="gradientTransform" dur="11s" repeatCount="indefinite" values="translate(1210 90) rotate(-15) scale(500 240);translate(1120 120) rotate(-10) scale(560 260);translate(1210 90) rotate(-15) scale(500 240)"/>
    </radialGradient>
    <pattern id="grid" x="0" y="0" width="36" height="36" patternUnits="userSpaceOnUse">
      <path d="M36 0H0V36" stroke="#22d3ee" stroke-opacity="0.22" stroke-width="1"/>
      <animateTransform attributeName="patternTransform" type="translate" dur="14s" repeatCount="indefinite" values="0 0;18 18;0 0"/>
    </pattern>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="10"/>
    </filter>
    <filter id="softStrong" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
    <linearGradient id="lineA" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#00e5ff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#00e5ff" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#00e5ff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="lineB" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff2bd6" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#ff2bd6" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#ff2bd6" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1400" height="420" fill="url(#bg)"/>
  <rect width="1400" height="420" fill="url(#glowA)"/>
  <rect width="1400" height="420" fill="url(#glowB)"/>
  <rect width="1400" height="420" fill="url(#grid)"/>
  <g opacity="0.55">
    <path d="M0 300H1400" stroke="url(#lineA)" stroke-width="2"/>
    <path d="M0 338H1400" stroke="url(#lineA)" stroke-width="2"/>
    <path d="M0 376H1400" stroke="url(#lineA)" stroke-width="2"/>
    <animate attributeName="opacity" dur="4s" repeatCount="indefinite" values="0.35;0.6;0.35"/>
  </g>
  <g stroke="#00e5ff" stroke-opacity="0.24" stroke-width="1.2">
    <path d="M700 420L100 250"/>
    <path d="M700 420L220 250"/>
    <path d="M700 420L340 250"/>
    <path d="M700 420L460 250"/>
    <path d="M700 420L580 250"/>
    <path d="M700 420L820 250"/>
    <path d="M700 420L940 250"/>
    <path d="M700 420L1060 250"/>
    <path d="M700 420L1180 250"/>
    <path d="M700 420L1300 250"/>
  </g>
  <g filter="url(#soft)" opacity="0.45">
    <ellipse cx="700" cy="165" rx="260" ry="80" fill="#00e5ff"/>
    <ellipse cx="700" cy="165" rx="170" ry="44" fill="#ff2bd6"/>
    <animate attributeName="opacity" dur="3.2s" repeatCount="indefinite" values="0.3;0.55;0.3"/>
  </g>
  <g filter="url(#softStrong)" opacity="0.4">
    <rect x="-320" y="266" width="320" height="2" fill="#00e5ff">
      <animate attributeName="x" dur="5.4s" repeatCount="indefinite" values="-320;1400"/>
      <animate attributeName="opacity" dur="5.4s" repeatCount="indefinite" values="0;0.95;0.95;0"/>
    </rect>
    <rect x="1400" y="354" width="220" height="1.5" fill="#ff2bd6">
      <animate attributeName="x" dur="6.8s" repeatCount="indefinite" values="1400;-220"/>
      <animate attributeName="opacity" dur="6.8s" repeatCount="indefinite" values="0;0.75;0.75;0"/>
    </rect>
  </g>
  <text x="700" y="152" text-anchor="middle" font-family="JetBrains Mono, Consolas, monospace" font-size="62" font-weight="700" fill="#e6fbff" letter-spacing="2">
    ${title}
    <animate attributeName="opacity" dur="2.7s" repeatCount="indefinite" values="0.86;1;0.86"/>
  </text>
  <text x="700" y="198" text-anchor="middle" font-family="JetBrains Mono, Consolas, monospace" font-size="20" font-weight="600" fill="#bff6ff" letter-spacing="1.4">
    ${subtitle}
    <animate attributeName="opacity" dur="3.5s" repeatCount="indefinite" values="0.72;1;0.72"/>
  </text>
</svg>`;
}

function buildDividerSvg() {
  return `<svg width="1400" height="86" viewBox="0 0 1400 86" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Neon divider">
  <defs>
    <linearGradient id="bg" x1="0" y1="43" x2="1400" y2="43" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#040714" stop-opacity="0"/>
      <stop offset="0.16" stop-color="#040714" stop-opacity="0.95"/>
      <stop offset="0.84" stop-color="#040714" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#040714" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="lineMain" x1="0" y1="43" x2="1400" y2="43" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#00e5ff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#00e5ff" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#00e5ff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="lineSub" x1="0" y1="43" x2="1400" y2="43" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff2bd6" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#ff2bd6" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#ff2bd6" stop-opacity="0"/>
    </linearGradient>
    <filter id="blur" x="-30%" y="-300%" width="160%" height="700%">
      <feGaussianBlur stdDeviation="6"/>
    </filter>
  </defs>
  <rect x="0" y="8" width="1400" height="70" fill="url(#bg)">
    <animate attributeName="opacity" dur="4.4s" repeatCount="indefinite" values="0.85;1;0.85"/>
  </rect>
  <line x1="20" y1="43" x2="1380" y2="43" stroke="url(#lineMain)" stroke-width="2">
    <animate attributeName="opacity" dur="2.8s" repeatCount="indefinite" values="0.65;1;0.65"/>
  </line>
  <line x1="60" y1="48" x2="1340" y2="48" stroke="url(#lineSub)" stroke-width="1.2" opacity="0.9"/>
  <line x1="140" y1="38" x2="1260" y2="38" stroke="url(#lineSub)" stroke-width="1.2" opacity="0.8"/>
  <line x1="350" y1="43" x2="1050" y2="43" stroke="#9ef9ff" stroke-width="5" opacity="0.35" filter="url(#blur)">
    <animate attributeName="x1" dur="5.4s" repeatCount="indefinite" values="280;420;280"/>
    <animate attributeName="x2" dur="5.4s" repeatCount="indefinite" values="980;1120;980"/>
  </line>
</svg>`;
}

function buildBadgeDefinition(metric, summary) {
  const topLanguage = summary.languages[0]?.language || "N/A";
  const languageVisual = resolveLanguageVisual(topLanguage);
  const lastPublicActivity = summary.recentActivity[0]?.createdAt;

  const map = {
    seguidores: {
      label: "seguidores",
      message: formatCompactNumber(summary.user.followers),
      color: BADGE_COLORS.success
    },
    repos: {
      label: "repositorios",
      message: `${summary.totals.publicRepositories} publicos`,
      color: BADGE_COLORS.secondary
    },
    estrelas: {
      label: "stars totais",
      message: formatCompactNumber(summary.totals.stars),
      color: BADGE_COLORS.accent
    },
    linguagem: {
      label: "top linguagem",
      message: topLanguage,
      color: languageVisual.color,
      iconPath: languageVisual.iconPath,
      iconColor: languageVisual.color
    },
    atividade: {
      label: "ultima atividade",
      message: formatRelativeTime(lastPublicActivity),
      color: BADGE_COLORS.violet
    },
    sync: {
      label: "sync readme",
      message: lastSync ? formatRelativeTime(lastSync) : "pendente",
      color: BADGE_COLORS.primary
    }
  };

  return map[metric] || null;
}

function findProject(summary, repoName) {
  const list = Array.isArray(summary.projectsByActivity) ? summary.projectsByActivity : [];
  return (
    list.find((project) => project.name.toLowerCase() === repoName.toLowerCase()) ||
    list.find((project) => project.fullName.toLowerCase().endsWith(`/${repoName.toLowerCase()}`)) ||
    null
  );
}

function buildProjectBadgeDefinition(metric, project) {
  const projectLanguageVisual = resolveLanguageVisual(project.language);
  const metrics = {
    atividade: {
      label: "atividade",
      message: `${project.activity.events} eventos`,
      color: BADGE_COLORS.violet
    },
    score: {
      label: "score",
      message: String(project.activity.score),
      color: BADGE_COLORS.indigo
    },
    estrelas: {
      label: "stars",
      message: formatCompactNumber(project.stars),
      color: BADGE_COLORS.accent
    },
    forks: {
      label: "forks",
      message: formatCompactNumber(project.forks),
      color: BADGE_COLORS.secondary
    },
    linguagem: {
      label: "stack",
      message: project.language || "N/A",
      color: projectLanguageVisual.color,
      iconPath: projectLanguageVisual.iconPath,
      iconColor: projectLanguageVisual.color
    },
    atualizado: {
      label: "atualizado",
      message: formatRelativeTime(project.updatedAt),
      color: BADGE_COLORS.primary
    }
  };

  return metrics[metric] || null;
}

function buildContactBadgeDefinition(channel) {
  const key = String(channel || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return CONTACT_BADGES[key] || null;
}

function formatStackDisplayName(rawTech, iconTitle) {
  if (iconTitle) {
    return iconTitle;
  }

  const normalized = String(rawTech || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!normalized) {
    return "N/A";
  }

  const acronyms = new Set([
    "api",
    "sdk",
    "cli",
    "sql",
    "css",
    "html",
    "xml",
    "aws",
    "gcp",
    "ui",
    "ux",
    "ios",
    "js",
    "ts"
  ]);

  return normalized
    .split(" ")
    .map((token) => {
      const lower = token.toLowerCase();
      if (acronyms.has(lower)) {
        return token.toUpperCase();
      }
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ");
}

function buildStackBadgeDefinition(tech) {
  const rawTech = String(tech || "").trim();
  if (!rawTech) {
    return null;
  }

  const key = normalizeIconLookup(rawTech);
  const base = STACK_BADGES[key] || null;
  const icon = resolveSimpleIcon(rawTech) || resolveSimpleIcon(key);
  const iconColor = icon ? normalizeHexColor(icon.hex, BADGE_COLORS.info) : null;

  return {
    label: base?.label || "Stack",
    message: base?.message || formatStackDisplayName(rawTech, icon?.title),
    color: iconColor || base?.color || BADGE_COLORS.info,
    iconPath: icon?.path || null,
    iconColor: iconColor || undefined
  };
}

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "perfil-server",
    startedAt,
    lastSync,
    lastSyncError
  });
});

app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>omnizap.xyz</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: "JetBrains Mono", Consolas, monospace;
      background: radial-gradient(circle at 20% 20%, #0ea5e9 0%, #020617 55%);
      color: #e2e8f0;
    }
    main {
      width: min(900px, 92vw);
      border: 1px solid rgba(226, 232, 240, 0.2);
      border-radius: 16px;
      padding: 32px;
      backdrop-filter: blur(4px);
      background: rgba(2, 6, 23, 0.65);
      box-shadow: 0 20px 50px rgba(2, 6, 23, 0.45);
    }
    h1 { margin: 0 0 16px 0; font-size: clamp(1.5rem, 5vw, 2.4rem); }
    p { margin: 8px 0; line-height: 1.5; }
    code {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 8px;
      background: rgba(14, 165, 233, 0.2);
      border: 1px solid rgba(14, 165, 233, 0.35);
    }
  </style>
</head>
<body>
  <main>
    <h1>omnizap.xyz online</h1>
    <p>Express server is running behind Nginx reverse proxy.</p>
    <p>Host: <code>${req.headers.host || "unknown"}</code></p>
    <p>Time (UTC): <code>${new Date().toISOString()}</code></p>
    <p>Health endpoint: <code>/health</code></p>
    <p>Summary endpoint: <code>/api/profile/summary</code></p>
    <p>Badge endpoint: <code>/badges/seguidores.svg</code></p>
  </main>
</body>
</html>`);
});

app.get("/api/profile/summary", async (_req, res) => {
  try {
    const summary = await getProfileSummary();
    res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      summary
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.get("/api/badges", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  res.status(200).json({
    ok: true,
    badges: {
      seguidores: `${baseUrl}/badges/seguidores.svg`,
      repos: `${baseUrl}/badges/repos.svg`,
      estrelas: `${baseUrl}/badges/estrelas.svg`,
      linguagem: `${baseUrl}/badges/linguagem.svg`,
      atividade: `${baseUrl}/badges/atividade.svg`,
      sync: `${baseUrl}/badges/sync.svg`,
      bannerHero: `${baseUrl}/banners/hero.svg`,
      bannerDivider: `${baseUrl}/banners/divider.svg`,
      contatoTemplate: `${baseUrl}/badges/contact/{github|linkedin|email|whatsapp}.svg`,
      stackTemplate: `${baseUrl}/badges/stack/{tecnologia-ou-slug-simple-icons}.svg`,
      iconTemplate: `${baseUrl}/badges/icon/{slug-ou-nome}.svg`,
      projetoTemplate: `${baseUrl}/badges/projeto/{repositorio}/{atividade|score|estrelas|forks|linguagem|atualizado}.svg`
    }
  });
});

app.get("/banners/hero.svg", async (req, res) => {
  const force = req.query.force === "1";
  let summary = null;

  try {
    summary = await getBadgeSummary({ force });
  } catch (error) {
    console.error(`[banner-hero] failed to load profile summary: ${error.message}`);
  }

  const svg = buildAnimatedHeroSvg(summary);
  res.set("Content-Type", "image/svg+xml; charset=utf-8");
  res.set("Cache-Control", `public, max-age=${Math.max(badgeCacheTtlSec, 15)}`);
  return res.status(200).send(svg);
});

app.get("/banners/divider.svg", (_req, res) => {
  const svg = buildDividerSvg();
  res.set("Content-Type", "image/svg+xml; charset=utf-8");
  res.set("Cache-Control", `public, max-age=${Math.max(badgeCacheTtlSec, 15)}`);
  return res.status(200).send(svg);
});

app.get("/badges/contact/:channel.svg", (req, res) => {
  const channel = String(req.params.channel || "").trim();
  const definition = buildContactBadgeDefinition(channel);

  if (!definition) {
    const notFoundSvg = renderBadgeSvg({
      label: "contato",
      message: "nao encontrado",
      color: BADGE_COLORS.danger
    });
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", "no-store");
    return res.status(404).send(notFoundSvg);
  }

  const svg = renderBadgeSvg(definition);
  res.set("Content-Type", "image/svg+xml; charset=utf-8");
  res.set("Cache-Control", `public, max-age=${Math.max(badgeCacheTtlSec, 15)}`);
  return res.status(200).send(svg);
});

app.get("/badges/stack/:tech.svg", (req, res) => {
  const tech = String(req.params.tech || "").trim();
  const definition = buildStackBadgeDefinition(tech);

  if (!definition) {
    const notFoundSvg = renderBadgeSvg({
      label: "stack",
      message: "nao encontrada",
      color: BADGE_COLORS.danger
    });
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", "no-store");
    return res.status(404).send(notFoundSvg);
  }

  const svg = renderBadgeSvg(definition);
  res.set("Content-Type", "image/svg+xml; charset=utf-8");
  res.set("Cache-Control", `public, max-age=${Math.max(badgeCacheTtlSec, 15)}`);
  return res.status(200).send(svg);
});

app.get("/badges/icon/:icon.svg", (req, res) => {
  const query = String(req.params.icon || "").trim();
  const icon = resolveSimpleIcon(query);

  if (!icon) {
    const notFoundSvg = renderBadgeSvg({
      label: "icon",
      message: "nao encontrado",
      color: BADGE_COLORS.danger
    });
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", "no-store");
    return res.status(404).send(notFoundSvg);
  }

  const svg = renderBadgeSvg({
    label: "icon",
    message: icon.title,
    color: normalizeHexColor(icon.hex, BADGE_COLORS.info),
    iconPath: icon.path,
    iconColor: normalizeHexColor(icon.hex, BADGE_COLORS.info)
  });
  res.set("Content-Type", "image/svg+xml; charset=utf-8");
  res.set("Cache-Control", `public, max-age=${Math.max(badgeCacheTtlSec, 15)}`);
  return res.status(200).send(svg);
});

app.get("/badges/projeto/:repo/:metric.svg", async (req, res) => {
  const repoName = String(req.params.repo || "").trim();
  const metric = String(req.params.metric || "").toLowerCase();
  const force = req.query.force === "1";

  try {
    const summary = await getBadgeSummary({ force });
    const project = findProject(summary, repoName);

    if (!project) {
      const notFoundSvg = renderBadgeSvg({
        label: "projeto",
        message: "nao encontrado",
        color: BADGE_COLORS.danger
      });
      res.set("Content-Type", "image/svg+xml; charset=utf-8");
      res.set("Cache-Control", "no-store");
      return res.status(404).send(notFoundSvg);
    }

    const definition = buildProjectBadgeDefinition(metric, project);
    if (!definition) {
      const invalidSvg = renderBadgeSvg({
        label: "badge",
        message: "metrica invalida",
        color: BADGE_COLORS.danger
      });
      res.set("Content-Type", "image/svg+xml; charset=utf-8");
      res.set("Cache-Control", "no-store");
      return res.status(404).send(invalidSvg);
    }

    const svg = renderBadgeSvg(definition);
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", `public, max-age=${Math.max(badgeCacheTtlSec, 15)}`);
    return res.status(200).send(svg);
  } catch (error) {
    console.error(`[badge-project] repo=${repoName} metric=${metric} failed: ${error.message}`);
    const errorSvg = renderBadgeSvg({
      label: "github",
      message: "erro",
      color: BADGE_COLORS.danger
    });
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", "no-store");
    return res.status(503).send(errorSvg);
  }
});

app.get("/badges/:metric.svg", async (req, res) => {
  const metric = String(req.params.metric || "").toLowerCase();
  const force = req.query.force === "1";

  try {
    const summary = await getBadgeSummary({ force });
    const definition = buildBadgeDefinition(metric, summary);

    if (!definition) {
      const notFoundSvg = renderBadgeSvg({
        label: "badge",
        message: "nao encontrado",
        color: BADGE_COLORS.danger
      });
      res.set("Content-Type", "image/svg+xml; charset=utf-8");
      res.set("Cache-Control", "no-store");
      return res.status(404).send(notFoundSvg);
    }

    const svg = renderBadgeSvg(definition);
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", `public, max-age=${Math.max(badgeCacheTtlSec, 15)}`);
    return res.status(200).send(svg);
  } catch (error) {
    console.error(`[badge] metric=${metric} failed: ${error.message}`);
    const errorSvg = renderBadgeSvg({
      label: "github",
      message: "erro",
      color: BADGE_COLORS.danger
    });
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", "no-store");
    return res.status(503).send(errorSvg);
  }
});

app.post("/api/readme/refresh", async (req, res) => {
  const expectedKey = process.env.README_REFRESH_KEY;
  const providedKey = req.get("x-refresh-key");

  if (!expectedKey || providedKey !== expectedKey) {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized. Set README_REFRESH_KEY and send it in x-refresh-key."
    });
  }

  try {
    const summary = await getProfileSummary({ force: true });
    const result = await updateReadmeWithSummary(summary, {
      readmePath,
      generatedAt: new Date().toISOString()
    });
    lastSync = result.generatedAt;
    lastSyncError = null;

    return res.status(200).json({
      ok: true,
      changed: result.changed,
      generatedAt: result.generatedAt,
      readmePath: result.readmePath
    });
  } catch (error) {
    lastSyncError = error.message;
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "not_found",
    message: `Route ${req.method} ${req.originalUrl} does not exist`
  });
});

async function syncReadme(reason) {
  try {
    const summary = await getProfileSummary({ force: true });
    const result = await updateReadmeWithSummary(summary, {
      readmePath,
      generatedAt: new Date().toISOString()
    });
    lastSync = result.generatedAt;
    lastSyncError = null;
    console.log(`[readme-sync] reason=${reason} changed=${result.changed} at=${result.generatedAt}`);
  } catch (error) {
    lastSyncError = error.message;
    console.error(`[readme-sync] reason=${reason} failed: ${error.message}`);
  }
}

app.listen(port, host, () => {
  console.log(`perfil-server listening on http://${host}:${port}`);

  if (!process.env.GITHUB_TOKEN) {
    console.warn("[readme-sync] GITHUB_TOKEN not found. Dynamic profile sync disabled.");
    return;
  }

  if (autoRefreshEnabled) {
    syncReadme("startup");
    const intervalMs = Math.max(autoRefreshIntervalMin, 5) * 60 * 1000;
    setInterval(() => {
      syncReadme("interval");
    }, intervalMs);
    console.log(`[readme-sync] auto-refresh enabled every ${Math.max(autoRefreshIntervalMin, 5)} minutes.`);
  } else {
    console.log("[readme-sync] auto-refresh disabled by README_AUTO_REFRESH=false");
  }
});
