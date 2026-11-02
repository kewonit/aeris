import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Words people read should say what is there, plainly. These slipped into
// the interface before, as marketing, as server setup, or as "tap" on a
// desktop, and the test keeps them out of the strings components render.
const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /stunning|premium|seamless|effortless/i, why: "marketing filler" },
  { pattern: /OPENAIP_API_KEY|\bICAO24\b/, why: "a developer term" },
  { pattern: /\bTap (?:to|play)\b/, why: "\"tap\" on a desktop; say what happens" },
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return entry.name.endsWith(".tsx") ? [fullPath] : [];
  });
}

/** The text a line shows people: its string literals and its JSX text. */
function visibleText(line: string): string[] {
  const strings = [...line.matchAll(/"([^"\\]*)"|'([^'\\]*)'|`([^`\\]*)`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
  const jsxText = [...line.matchAll(/>([^<>{}]+)</g)].map((match) => match[1]);
  const bare = /^\s*[A-Z][^=;(){}]*$/.test(line) ? [line] : [];
  return [...strings, ...jsxText, ...bare];
}

test("interface copy stays plain", () => {
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const violations: string[] = [];
  for (const file of sourceFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, file);
    // The changelog is a record of what was said at the time, kept as written.
    let inChangelog = false;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (/^export const CHANGELOG\b/.test(line)) inChangelog = true;
        else if (inChangelog && /^\];/.test(line)) inChangelog = false;
        if (inChangelog || /^\s*(?:\/\/|\/?\*)/.test(line)) return;
        for (const text of visibleText(line)) {
          for (const { pattern, why } of BANNED) {
            if (pattern.test(text)) {
              violations.push(`${relative}:${index + 1} ${why}: ${text.trim()}`);
            }
          }
        }
      });
  }
  assert.deepEqual(violations, []);
});
