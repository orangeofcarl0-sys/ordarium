// Regenerates docs/llms-full.txt (the coding-agent context bundle) from the
// current documentation in this repository.
//
//   node tools/build-llms-full.mjs          rewrite docs/llms-full.txt
//   node tools/build-llms-full.mjs --check  fail if it is stale
//
// The section list and order are taken from the file itself (its
// `<!-- BEGIN <path> -->` markers), so curation is an explicit editorial
// decision recorded in the artifact rather than something this script invents.
// Paths that no longer exist are a hard error: silently dropping a vanished
// page would make the bundle drift away from the docs it claims to contain.
//
// Historical material (docs/research/**, evidence/**) is intentionally not
// part of the curated set.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(ROOT, "docs", "llms-full.txt");
const CHECK = process.argv.includes("--check");

if (!existsSync(TARGET)) {
  process.stderr.write("docs/llms-full.txt is missing; nothing to regenerate from\n");
  process.exit(1);
}

// Line endings are normalised on both sides: the artifact is committed with LF
// (.gitattributes), but a checkout on a platform with core.autocrlf=true may
// materialise CRLF, and that must not read as "stale".
const normalize = (text) => text.replace(/\r\n/g, "\n");
const read = (path) => normalize(readFileSync(path, "utf8"));

const current = read(TARGET);
const sections = [...current.matchAll(/<!-- BEGIN ([^\s]+) -->/g)].map((match) => match[1]);
if (sections.length === 0) {
  process.stderr.write("docs/llms-full.txt has no <!-- BEGIN <path> --> markers\n");
  process.exit(1);
}

const missing = sections.filter((relative) => !existsSync(join(ROOT, relative)));
if (missing.length > 0) {
  process.stderr.write(`curated section(s) no longer exist:\n  ${missing.join("\n  ")}\n`);
  process.exitCode = 1;
} else {
  const header = current.split("<!-- BEGIN")[0].trimEnd();
  const parts = [header, ""];
  for (const relative of sections) {
    const body = readFileSync(join(ROOT, relative), "utf8").trimEnd();
    parts.push("", `<!-- BEGIN ${relative} -->`, "", body, "", `<!-- END ${relative} -->`);
  }
  const next = `${parts.join("\n")}\n`;
  if (next === current) {
    process.stdout.write(`docs/llms-full.txt is current (${sections.length} sections)\n`);
  } else if (CHECK) {
    process.stderr.write(
      "docs/llms-full.txt is stale; run `node tools/build-llms-full.mjs` and commit the result\n",
    );
    process.exitCode = 1;
  } else {
    writeFileSync(TARGET, next);
    process.stdout.write(
      `regenerated docs/llms-full.txt from ${sections.length} sections (${current.length} -> ${next.length} bytes)\n`,
    );
  }
}
