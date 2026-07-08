// ワークフロー失敗時にLINEへ知らせる（if: failure() のステップから呼ばれる）。
// 「通知が来ない＝新着なし」と「通知が来ない＝壊れている」を区別できるようにするのが目的。
// LINE自体が原因で失敗した場合はこの通知も届かないが、それは許容する
import { broadcastLine } from "./line.js";

const label = process.argv[2] ?? "配信処理";
const runUrl = process.env.RUN_URL;

let text = `⚠️ ${label}の処理が失敗しました。`;
if (runUrl) text += `\nログ: ${runUrl}`;

await broadcastLine(text);
console.log("失敗通知を送信しました");
