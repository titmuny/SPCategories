import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const HTML_FILES = ["index.html", "home.html", "backup.html"];
const EXCLUDE_DIRS = new Set(["node_modules", ".git", ".vscode"]);

const thresholdKB = Number.parseInt(process.argv[2] || "150", 10);
const quality = Number.parseInt(process.argv[3] || "72", 10);
const force = process.argv.includes("--force");

const thresholdBytes = Math.max(1, thresholdKB) * 1024;

async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
      continue;
    }
    const lower = entry.name.toLowerCase();
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
      out.push(full);
    }
  }
  return out;
}

async function convertImages(files) {
  let converted = 0;
  let skippedSmall = 0;
  let skippedFresh = 0;
  let failed = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;
  const convertedSet = new Set();

  for (const file of files) {
    try {
      const stat = await fs.stat(file);
      if (stat.size < thresholdBytes) {
        skippedSmall++;
        continue;
      }

      const webpPath = file.replace(/\.(jpe?g)$/i, ".webp");
      const webpStat = await fs.stat(webpPath).catch(() => null);
      if (!force && webpStat && webpStat.mtimeMs >= stat.mtimeMs) {
        skippedFresh++;
        convertedSet.add(path.relative(ROOT, webpPath).replace(/\\/g, "/"));
        continue;
      }

      await sharp(file).webp({ quality, effort: 4 }).toFile(webpPath);
      const outStat = await fs.stat(webpPath);

      converted++;
      bytesBefore += stat.size;
      bytesAfter += outStat.size;
      convertedSet.add(path.relative(ROOT, webpPath).replace(/\\/g, "/"));
    } catch {
      failed++;
    }
  }

  return {
    converted,
    skippedSmall,
    skippedFresh,
    failed,
    bytesBefore,
    bytesAfter,
    convertedSet,
  };
}

function normalizeRef(ref) {
  return ref.replace(/\\/g, "/").replace(/^\.\//, "");
}

async function updateHtmlReferences(convertedSet) {
  let filesChanged = 0;
  let refsChanged = 0;

  for (const htmlFile of HTML_FILES) {
    const abs = path.join(ROOT, htmlFile);
    const exists = await fs.stat(abs).then(() => true).catch(() => false);
    if (!exists) continue;

    const original = await fs.readFile(abs, "utf8");
    let changed = 0;
    const updated = original.replace(
      /(src|href|data-src)\s*=\s*"([^"]+\.(?:jpg|jpeg))"/gi,
      (match, attr, refPath) => {
        if (/^https?:\/\//i.test(refPath)) return match;
        const webpRef = refPath.replace(/\.(jpe?g)$/i, ".webp");
        const normalized = normalizeRef(webpRef);
        if (!convertedSet.has(normalized)) return match;
        changed++;
        return `${attr}="${webpRef}"`;
      }
    );

    if (changed > 0) {
      await fs.writeFile(abs, updated, "utf8");
      filesChanged++;
      refsChanged += changed;
    }
  }

  return { filesChanged, refsChanged };
}

async function main() {
  const files = await walk(ROOT);
  const result = await convertImages(files);
  const html = await updateHtmlReferences(result.convertedSet);

  const savedBytes = Math.max(0, result.bytesBefore - result.bytesAfter);
  const savedMB = (savedBytes / (1024 * 1024)).toFixed(2);

  console.log(`threshold_kb=${thresholdKB} quality=${quality} force=${force}`);
  console.log(`jpg_found=${files.length}`);
  console.log(`converted=${result.converted}`);
  console.log(`skipped_small=${result.skippedSmall}`);
  console.log(`skipped_up_to_date=${result.skippedFresh}`);
  console.log(`failed=${result.failed}`);
  console.log(`bytes_before=${result.bytesBefore}`);
  console.log(`bytes_after=${result.bytesAfter}`);
  console.log(`saved_mb=${savedMB}`);
  console.log(`html_files_changed=${html.filesChanged}`);
  console.log(`html_refs_changed=${html.refsChanged}`);
}

await main();
