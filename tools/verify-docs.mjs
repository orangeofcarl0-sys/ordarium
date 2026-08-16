// Documentation and public-claims verification (G7 design spec §3, G7-A10):
//   1. every markdown link inside docs/ and the two READMEs resolves to a file
//   2. mermaid code fences are balanced across all documents
//   3. the public READMEs contain no unqualified exactly-once / tamper-proof /
//      strong-sandbox / complete-harness marketing claims (qualified
//      negations are allowed; the design docs legitimately discuss these
//      terms, so the claims audit is scoped to the consumer-facing surfaces)

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const readmes = [
  join(ROOT, "README.md"),
  join(ROOT, "..", "README.md"),
].filter(existsSync);
const documents = [
  ...readmes,
  ...readdirSync(join(ROOT, "..", "docs")).map((name) => join(ROOT, "..", "docs", name)),
].filter((path) => path.endsWith(".md") && existsSync(path));

const banned = /exactly[- ]once|tamper[- ]proof|tamper[- ]evident|strong sandbox|complete harness/giu;
const qualified = /does not claim|does not promise|cannot prove|unable to prove|not a guarantee|refuses|never claims|不宣称|不承诺|无法证明|不能证明|不是.*保证|拒绝|绝不|不能把它|不构成|无法单方面|不宣传|不把|不等于|没有.*能力/iu;

for (const document of documents) {
  const text = readFileSync(document, "utf8");
  const relative = document.slice(ROOT.length + 1);

  if (readmes.includes(document)) {
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      for (const match of line.matchAll(banned)) {
        if (!qualified.test(line)) {
          failures.push(
            `${relative}:${index + 1}: unqualified claim term "${match[0]}" - qualify the negation or remove it`,
          );
        }
      }
    });
  }

  const fences = (text.match(/```/gu) ?? []).length;
  if (fences % 2 !== 0) {
    failures.push(`${relative}: unbalanced code fences (${fences} backtick-fence markers)`);
  }

  for (const match of text.matchAll(/\]\(([^)#\s]+\.md)/gu)) {
    const target = join(dirname(document), match[1]);
    if (!existsSync(target)) {
      failures.push(`${relative}: broken markdown link -> ${match[1]}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`verify:docs FAILED (${failures.length}):\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exitCode = 1;
} else {
  console.log(`verify:docs passed (${documents.length} documents checked)`);
}
