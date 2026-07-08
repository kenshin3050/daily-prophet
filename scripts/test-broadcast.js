import { broadcastLine } from "./line.js";

await broadcastLine("疎通確認テスト：この通知が届けばLINE Bot連携は成功です。");
console.log("送信成功。LINEアプリに通知が届いているか確認してください。");
