import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fetchSiteLatest } from "./fetch-site.js";
import { buildJournalMessages } from "./format-flex.js";
import { broadcastMessages } from "./line.js";
import { decideWindow, sleepUntil } from "./schedule-window.js";
import { wasSentToday, markSentToday } from "./last-sent-store.js";

// ウォッチ対象サイトのジャーナル記事（2026-11時点で643件）から毎日1本をランダムに紹介する。
// 2026-11-11にユーザーの要望で「新着通知」から「全記事からランダム1本」へ変更した。
// 新着だけだと興味を引かず読まれていなかったのが理由。
//
// 出した記事は記録して、全部出し切るまで同じ記事を繰り返さない（643件＝約1.8年分）。
// この記録ファイルはpublicリポジトリに入るため、生URLではなくSHA-256ハッシュで保存する
const SHOWN_PATH = new URL("../data/journal-shown.json", import.meta.url);

function hashUrl(url) {
  return createHash("sha256").update(url).digest("hex");
}

function loadShown() {
  try {
    return new Set(JSON.parse(readFileSync(SHOWN_PATH, "utf-8")));
  } catch {
    return new Set();
  }
}

function saveShown(hashes) {
  writeFileSync(SHOWN_PATH, JSON.stringify([...hashes], null, 2) + "\n");
}

// 未紹介の記事からランダムに1本選ぶ。全部出し切ったら記録を空にして一巡目に戻る
export function pickUnshown(items, shown) {
  let pool = items.filter((item) => !shown.has(hashUrl(item.url)));
  let reset = false;
  if (pool.length === 0) {
    pool = items;
    reset = true;
  }
  return { item: pool[Math.floor(Math.random() * pool.length)], remaining: pool.length, reset };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 対象 URL はSecretsで渡す（publicリポジトリにサイト名を書かない方針）。
  // 未設定のうちは、誤った一覧ページから配信しないよう何もせず終了する
  const journalUrl = process.env.JOURNAL_URL;
  if (!journalUrl) {
    console.log("JOURNAL_URL が未設定のためジャーナル配信をスキップします");
    process.exit(0);
  }

  if (wasSentToday("journal")) {
    console.log("ジャーナルは本日分を送信済みのためスキップします");
    process.exit(0);
  }

  const hhmm = process.env.TARGET_TIME_JST;
  const { action, target, reason } = decideWindow(hhmm);
  console.log(reason);
  if (action === "skip") process.exit(0);

  const items = await fetchSiteLatest(journalUrl);
  console.log(`ジャーナル記事 ${items.length}件を取得`);
  if (items.length === 0) throw new Error("ジャーナル記事が1件も取得できませんでした");

  const shown = loadShown();
  const { item, remaining, reset } = pickUnshown(items, shown);
  if (reset) console.log("全記事を紹介し終えたため、記録をリセットして一巡目に戻ります");
  console.log(`未紹介 ${remaining}件から選択: ${item.title}`);

  const label = process.env.JOURNAL_LABEL || "ジャーナル";
  if (target !== null) await sleepUntil(target, `目標時刻 ${hhmm} JST`);
  await broadcastMessages(buildJournalMessages({ label, item }));

  saveShown(reset ? new Set([hashUrl(item.url)]) : shown.add(hashUrl(item.url)));
  markSentToday("journal");
  console.log(`配信完了: ${item.title} (${item.date})`);
}
