import { pathToFileURL } from "node:url";
import { fetchFeed } from "./simple-rss.js";
import { SOURCES } from "./sources.js";

// edition: "morning" | "evening"。sinceHours以内に公開された記事だけ残す
// （配信済みかどうかはseen-store側で見るため、ここでの時間窓は候補リストが
// 際限なく膨らまないようにするための緩いキャップ。24時間おきの配信サイクルに
// 対して余裕を持たせ、抜け漏れが出ないよう48時間をデフォルトにしている）
export async function fetchItems(edition, sinceHours = 48) {
  const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
  const items = [];
  const failures = [];

  // 全ソースを並行取得（遅いフィードが1つあっても全体の所要時間が伸びないように）
  const results = await Promise.all(
    SOURCES[edition].map(async (source) => {
      try {
        return { source, entries: await fetchFeed(source.url) };
      } catch (err) {
        console.error(`[${source.name}] 取得失敗: ${err.message}`);
        return { source, entries: null };
      }
    })
  );

  for (const { source, entries } of results) {
    if (entries === null) {
      failures.push(source.name);
      continue;
    }
    for (const entry of entries) {
      const pubDate = entry.isoDate ? new Date(entry.isoDate).getTime() : null;
      if (pubDate && pubDate < cutoff) continue;
      items.push({
        source: source.name,
        title: entry.title,
        link: entry.link,
        pubDate: entry.isoDate ?? null,
        description: entry.description ?? null,
      });
    }
  }

  return { items, failures };
}

// CLIから直接実行した場合は結果を表示するだけ（動作確認用）
// （node -e等から importされた場合はprocess.argv[1]がundefinedになるためガードする）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const edition = process.argv[2] ?? "morning";
  const { items, failures } = await fetchItems(edition, 24 * 14); // 動作確認用に14日分まで緩める
  console.log(`${edition}: ${items.length}件取得`);
  if (failures.length > 0) console.log(`取得失敗: ${failures.join(", ")}`);
  for (const item of items) {
    console.log(`- [${item.source}] ${item.title} (${item.pubDate ?? "日付不明"})`);
  }
}
