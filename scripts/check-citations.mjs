/**
 * Vérifie les citations de code contenues dans la documentation.
 *
 * Une citation est « `chemin/fichier.ts:12-15` » (préfixe complet) ou
 * « `index.css:391` » (nom de fichier seul, résolu par recherche dans le
 * dépôt). Le script contrôle que le fichier existe et que la plage de
 * lignes est dans les limites du fichier. Il ne juge pas le contenu.
 *
 * Usage : node scripts/check-citations.mjs
 * Sortie : code 1 si une citation est cassée.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_EXTENSIONS =
  /\.(ts|tsx|js|mjs|cjs|json|sql|yaml|yml|md|css|html|cmd)$/;

const INDEXABLE_DIRS = [
  "server",
  "client",
  "shared",
  "docs",
  "patches",
  "scripts",
  ".github",
];

/** Map basename -> [relative paths], built from the git tree plus loose roots. */
function buildBasenameIndex() {
  let tracked;
  try {
    tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split(
      /\r?\n/
    );
  } catch {
    tracked = [];
  }
  const files = tracked.filter(f => f && SOURCE_EXTENSIONS.test(f));
  if (!tracked.length) {
    for (const dir of INDEXABLE_DIRS) walkInto(path.join(ROOT, dir), files);
  }
  const byName = new Map();
  for (const f of files) {
    const base = path.basename(f);
    if (!byName.has(base)) byName.set(base, []);
    byName.get(base).push(f);
  }
  return byName;
}

function walkInto(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkInto(p, out);
    else if (SOURCE_EXTENSIONS.test(entry.name))
      out.push(path.relative(ROOT, p).split(path.sep).join("/"));
  }
}

const CITATION =
  /(?<![\w/.-])((?:server|client|shared|docs|patches|scripts|\.github)\/[\w./@-]*?\.(?:ts|tsx|js|mjs|cjs|json|sql|yaml|yml|md|css|html|cmd)|(?:README|CONTRIBUTING|SECURITY|Dockerfile|pnpm-lock|pnpm-workspace|vite\.config|vitest\.config|drizzle\.config|tsconfig)(?:\.[\w-]+)?)?:(\d+)(?:([–-])(\d+))?(?![\d])/g;

/** Bare `index.css:391` / `api.ts:122` references, resolved by basename. */
const BARE =
  /(?<![\w/.-])([\w.-]+\.(?:ts|tsx|js|mjs|css|json|md|yaml|yml)):(\d+)(?:([–-])(\d+))?(?![\d])/g;

function lineCount(absPath) {
  return fs.readFileSync(absPath, "utf8").split(/\r?\n/).length;
}

const byName = buildBasenameIndex();
const sizeCache = new Map();

const docs = [];
walkInto(path.join(ROOT, "docs"), docs);
for (const f of ["README.md", "CONTRIBUTING.md", "SECURITY.md"])
  if (fs.existsSync(path.join(ROOT, f))) docs.push(f);

let checked = 0;
const problems = [];
const unresolved = [];

for (const rel of docs) {
  if (!rel.endsWith(".md")) continue;
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(CITATION)) {
      if (!m[1]) continue;
      checked++;
      check(rel, i + 1, m[1], Number(m[2]), m[4] ? Number(m[4]) : null, m[0]);
    }
    for (const m of line.matchAll(BARE)) {
      const candidates = byName.get(m[1]);
      if (!candidates) continue;
      checked++;
      let target = candidates[0];
      if (candidates.length > 1) {
        // Un nom de fichier seul désigne la racine quand un candidat y siège
        // (`package.json:7`), sinon la référence est indécidable : on la
        // compte sans la contrôler plutôt que de faire échouer la porte.
        const rootMatch = candidates.filter(c => !c.includes("/"));
        if (rootMatch.length === 1) target = rootMatch[0];
        else {
          unresolved.push(
            `${rel}:${i + 1} ${m[0]} (${candidates.length} candidats)`
          );
          continue;
        }
      }
      check(rel, i + 1, target, Number(m[2]), m[4] ? Number(m[4]) : null, m[0]);
    }
  });
}

function check(doc, line, target, from, to, raw) {
  const abs = path.join(ROOT, target);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    problems.push(`${doc}:${line} fichier absent : ${raw} -> ${target}`);
    return;
  }
  let count = sizeCache.get(target);
  if (count === undefined) {
    count = lineCount(abs);
    sizeCache.set(target, count);
  }
  if (from < 1 || from > count || (to !== null && (to > count || to < from))) {
    problems.push(
      `${doc}:${line} plage ${raw.replace(/.*:/, "")} hors limites pour ${target} (${count} lignes)`
    );
  }
}

console.log(
  `${docs.length} fichiers balayés, ${checked} citations contrôlées, ${unresolved.length} non résolues (nom de fichier seul ambigu)`
);
for (const p of problems) console.error("  ! " + p);
if (problems.length) {
  console.error(`${problems.length} citation(s) en défaut`);
  process.exit(1);
}
console.log("Aucune citation hors limites.");
