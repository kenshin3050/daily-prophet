import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fetchSiteLatest } from "./fetch-site.js";
import { broadcastLine } from "./line.js";

const SEEN_PATH = new URL("../data/site-seen.json", import.meta.url);

// 既知URLはSHA-256ハッシュで保存する。このファイルはpublicリポジトリに
// コミットされるため、生のURLを入れると監視対象サイトが分かってしまう
function hashUrl(url) {
  return createHash("sha256").update(url).digest("hex");
}

function loadSeen() {
  try {
    return new Set(JSON.parse(readFileSync(SEEN_PATH, "utf-8")));
  } catch {
    return new Set();
  }
}

function saveSeen(hashes) {
  writeFileSync(SEEN_PATH, JSON.stringify(hashes, null, 2) + "\n");
}

function formatNotification(newItems) {
  const label = process.env.WATCH_LABEL || "ウォッチ対象サイト";
  const body = newItems
    .map((item) => `・${item.title}\n  ${item.url}`)
    .join("\n\n");
  return `【${label}】新着記事があります\n\n${body}`;
}

export async function checkSite() {
  const seen = loadSeen();
  const isFirstRun = seen.size === 0;

  const items = await fetchSiteLatest();
  const newItems = items.filter((item) => !seen.has(hashUrl(item.url)));

  // 初回実行時は既存記事を「新着」として通知しない（現在のURL集合を記録するだけ）
  if (newItems.length > 0 && !isFirstRun) {
    await broadcastLine(formatNotification(newItems));
  }

  saveSeen(items.map((item) => hashUrl(item.url)));

  return { isFirstRun, notified: isFirstRun ? [] : newItems, total: items.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkSite();
  if (result.isFirstRun) {
    console.log(`初回実行: ${result.total}件を既知として記録（通知なし）`);
  } else if (result.notified.length > 0) {
    console.log(`新着${result.notified.length}件を通知:`);
    for (const item of result.notified) console.log(`- ${item.title}`);
  } else {
    console.log("新着なし");
  }
}
