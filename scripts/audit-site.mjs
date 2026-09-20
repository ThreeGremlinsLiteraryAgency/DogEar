import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const htmlFiles = readdirSync(root)
  .filter((name) => extname(name).toLowerCase() === ".html")
  .sort();
const errors = [];
const temp = mkdtempSync(join(tmpdir(), "paper-gremlin-audit-"));

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function isDynamic(value) {
  return value.includes("${") || value.startsWith("javascript:");
}

function checkLocalReference(file, text, rawValue, index, attribute) {
  const raw = rawValue.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return;

  const checkable = isDynamic(raw)
    ? raw.slice(0, raw.indexOf("${"))
    : raw;
  if (!checkable || checkable.endsWith("=")) return;

  let url;
  try {
    url = new URL(checkable, "https://paper-gremlin.invalid/");
  } catch {
    errors.push(`${file}:${lineNumber(text, index)} invalid ${attribute}: ${raw}`);
    return;
  }

  if (url.origin !== "https://paper-gremlin.invalid") return;
  const localPath = resolve(root, `.${decodeURIComponent(url.pathname)}`);
  if (!localPath.startsWith(`${root}/`) || !statSafe(localPath)) {
    errors.push(`${file}:${lineNumber(text, index)} missing local ${attribute}: ${raw}`);
  }
}

function statSafe(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

try {
  for (const file of htmlFiles) {
    const path = join(root, file);
    const text = readFileSync(path, "utf8");
    const ids = new Map();

    for (const match of text.matchAll(/\bid\s*=\s*(["'])(.*?)\1/gi)) {
      const id = match[2];
      if (isDynamic(id)) continue;
      const locations = ids.get(id) || [];
      locations.push(lineNumber(text, match.index));
      ids.set(id, locations);
    }

    for (const [id, locations] of ids) {
      if (locations.length > 1) {
        errors.push(`${file} duplicate id "${id}" on lines ${locations.join(", ")}`);
      }
    }

    for (const match of text.matchAll(/\b(href)\s*=\s*(["'])(.*?)\2/gi)) {
      checkLocalReference(file, text, match[3], match.index, "href");
    }
    for (const match of text.matchAll(/\b(src)\s*=\s*(["'])(.*?)\2/gi)) {
      checkLocalReference(file, text, match[3], match.index, "src");
    }

    for (const match of text.matchAll(/["'`]([a-z0-9][a-z0-9-]*\.html)(?:[?#]|["'`])/gi)) {
      if (!statSafe(join(root, match[1]))) {
        errors.push(`${file}:${lineNumber(text, match.index)} references missing page: ${match[1]}`);
      }
    }

    let scriptIndex = 0;
    for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attributes = match[1];
      const source = match[2].trim();
      if (!source || /\bsrc\s*=/.test(attributes) || /type\s*=\s*["'](?:application\/json|importmap)["']/.test(attributes)) continue;

      scriptIndex += 1;
      const scriptPath = join(temp, `${basename(file, ".html")}-${scriptIndex}.js`);
      writeFileSync(scriptPath, source);
      const result = spawnSync(process.execPath, ["--check", scriptPath], { encoding: "utf8" });
      if (result.status !== 0) {
        errors.push(`${file} inline script ${scriptIndex} failed syntax check:\n${result.stderr.trim()}`);
      }
    }

  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}

for (const error of errors) console.error(`ERROR ${error}`);
console.log(`Audited ${htmlFiles.length} HTML files: ${errors.length} error(s).`);
process.exitCode = errors.length ? 1 : 0;
