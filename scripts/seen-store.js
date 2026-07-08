import { readFileSync, writeFileSync } from "node:fs";

const MAX_ENTRIES = 300;

function seenPath(edition) {
  return new URL(`../data/seen-${edition}.json`, import.meta.url);
}

export function loadSeen(edition) {
  try {
    return new Set(JSON.parse(readFileSync(seenPath(edition), "utf-8")));
  } catch {
    return new Set();
  }
}

// 既存の記録に新規URLを追加し、直近MAX_ENTRIES件だけ残す
export function addSeen(edition, newUrls) {
  const existing = [...loadSeen(edition)];
  const merged = [...existing, ...newUrls];
  const deduped = [...new Set(merged)].slice(-MAX_ENTRIES);
  writeFileSync(seenPath(edition), JSON.stringify(deduped, null, 2) + "\n");
}
