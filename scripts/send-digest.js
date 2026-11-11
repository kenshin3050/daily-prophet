import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildDigest } from "./build-digest.js";
import { attachThumbnails } from "./fetch-thumbnails.js";
import { buildDigestMessages } from "./format-flex.js";
import { broadcastMessages } from "./line.js";
import { decideWindow, sleepUntil } from "./schedule-window.js";
import { addSeen } from "./seen-store.js";
import { wasSentToday, markSentToday, todayJst } from "./last-sent-store.js";

const edition = process.argv[2] ?? "morning";
if (!["morning", "evening"].includes(edition)) {
  console.error('第一引数は "morning" か "evening" を指定してください');
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (wasSentToday(edition)) {
    console.log(`${edition}は本日分を送信済みのためスキップします`);
    process.exit(0);
  }

  // このrunが今日の配信担当かを起動時刻から判定する（判定基準はschedule-window.js）
  const hhmm = process.env.TARGET_TIME_JST;
  const { action, target, reason } = decideWindow(hhmm);
  console.log(reason);
  if (action === "skip") process.exit(0);

  // 起動が数時間前になるため、記事の鮮度を保つよう生成は定刻2分前から始める。
  // 生成が2分で終われば送信は定刻ちょうど、超過してもその分だけ遅れて送られる
  if (target !== null) await sleepUntil(target - 2 * 60 * 1000, `目標時刻 ${hhmm} JST の2分前`);

  const { text, selected, selectedUrls, failures, label } = await buildDigest(edition);
  await attachThumbnails(selected);
  const messages = buildDigestMessages({ label, selected, failures });

  if (target !== null) await sleepUntil(target, `目標時刻 ${hhmm} JST`);
  await broadcastMessages(messages);
  if (selectedUrls.length > 0) addSeen(edition, selectedUrls);
  markSentToday(edition);

  // 後から振り返れるよう、配信した内容のテキスト版を残す
  if (selected.length > 0) {
    mkdirSync(new URL("../archive/", import.meta.url), { recursive: true });
    writeFileSync(new URL(`../archive/${todayJst()}-${edition}.md`, import.meta.url), text + "\n");
  }

  console.log("配信完了:");
  console.log(text);
}
