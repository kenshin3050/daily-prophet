import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildDigest } from "./build-digest.js";
import { attachThumbnails } from "./fetch-thumbnails.js";
import { buildDigestMessages } from "./format-flex.js";
import { broadcastMessages } from "./line.js";
import { addSeen } from "./seen-store.js";
import { wasSentToday, markSentToday, todayJst } from "./last-sent-store.js";

const edition = process.argv[2] ?? "morning";
if (!["morning", "evening"].includes(edition)) {
  console.error('第一引数は "morning" か "evening" を指定してください');
  process.exit(1);
}

// GitHub Actionsのscheduleは混雑時に遅延するため、cronは目標時刻より早めに設定し、
// ここで目標時刻（JST、"07:03"形式）まで待ってから送信する。
// 既に目標時刻を過ぎていれば（遅延した本命や保険cron）待たずに即送信。
// 90分以上先はcron設定ミスとみなして待たない
async function waitUntilJst(hhmm) {
  if (!hhmm) return;
  const [h, m] = hhmm.split(":").map(Number);
  const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const targetMs =
    Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate(), h, m, 0) -
    9 * 60 * 60 * 1000;
  const waitMs = targetMs - Date.now();
  if (waitMs <= 0 || waitMs > 90 * 60 * 1000) return;
  console.log(`目標時刻 ${hhmm} JST まで ${Math.round(waitMs / 1000)}秒待機します`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (wasSentToday(edition)) {
    console.log(`${edition}は本日分を送信済みのためスキップします`);
    process.exit(0);
  }

  // 先にダイジェストを作っておき、送信だけを目標時刻ちょうどに行う
  const { text, selected, selectedUrls, failures, label } = await buildDigest(edition);
  await attachThumbnails(selected);
  const messages = buildDigestMessages({ label, selected, failures });
  await waitUntilJst(process.env.TARGET_TIME_JST);
  await broadcastMessages(messages);
  if (selectedUrls.length > 0) addSeen(edition, selectedUrls);
  markSentToday(edition);

  // 後から振り返れるよう、配信したダイジェストのテキスト版を残す（記事があった日のみ）
  if (selected.length > 0) {
    mkdirSync(new URL("../archive/", import.meta.url), { recursive: true });
    writeFileSync(new URL(`../archive/${todayJst()}-${edition}.md`, import.meta.url), text + "\n");
  }

  console.log("配信完了:");
  console.log(text);
}
