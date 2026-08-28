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

// GitHub Actionsのscheduleは起動が遅延する（通常25〜55分、2026-08-27には8〜11時間の
// 大幅遅延と実行の取りこぼしが発生）。そこでcronを目標時刻の前後に多数ばらまき、
// 「どのrunが自分の担当か」をこのスクリプト側の時刻判定で決める。
//
// 目標時刻（TARGET_TIME_JST、JSTの"07:00"形式）との差で3通りに分岐する:
//   1. 5時間より前に起動   → 何もせず終了。後続のcronに任せる
//      （以前は「待たずに即送信」だったため、13時間早く起動したrunが夕刊を朝4時に
//        配信し、さらにその日の枠を使い切って本来の17時配信を潰す事故が起きた）
//   2. 5時間前〜目標時刻    → 目標時刻ちょうどに送信（担当run。生成は定刻2分前から）
//   3. 目標を2時間まで超過  → 遅れているので即送信。それ以上過ぎていたら送らない
//      （深夜に夕刊が届くくらいならスキップする）
const MAX_EARLY_MINUTES = 300;
const GRACE_MINUTES = 120;

// "07:00"（JST）を今日のエポックミリ秒に変換する。
// ランナーはUTCで動くため、JST基準の年月日を取ってから9時間差し引く
function targetEpoch(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return (
    Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate(), h, m, 0) -
    9 * 60 * 60 * 1000
  );
}

async function sleepUntil(epochMs, note) {
  const waitMs = epochMs - Date.now();
  if (waitMs <= 0) return;
  console.log(`${note}まで ${Math.round(waitMs / 1000)}秒待機します`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (wasSentToday(edition)) {
    console.log(`${edition}は本日分を送信済みのためスキップします`);
    process.exit(0);
  }

  // TARGET_TIME_JSTが空のとき（手動実行）は時刻判定をせず即送信する
  const target = process.env.TARGET_TIME_JST ? targetEpoch(process.env.TARGET_TIME_JST) : null;
  if (target !== null) {
    const diffMin = Math.round((target - Date.now()) / 60000);
    if (diffMin > MAX_EARLY_MINUTES) {
      console.log(`目標時刻まで${diffMin}分あります。担当は後続のcronなので送信しません`);
      process.exit(0);
    }
    if (diffMin < -GRACE_MINUTES) {
      console.log(`目標時刻を${-diffMin}分過ぎています。遅すぎるので送信しません`);
      process.exit(0);
    }
    // 起動が数時間前になるため、記事の鮮度を保つよう生成は定刻2分前から始める。
    // 生成が2分で終われば送信は定刻ちょうど、超過してもその分だけ遅れて送られる
    await sleepUntil(target - 2 * 60 * 1000, `目標時刻 ${process.env.TARGET_TIME_JST} JST の2分前`);
  }

  const { text, selected, selectedUrls, failures, label } = await buildDigest(edition);
  await attachThumbnails(selected);
  const messages = buildDigestMessages({ label, selected, failures });
  if (target !== null) await sleepUntil(target, `目標時刻 ${process.env.TARGET_TIME_JST} JST`);
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
