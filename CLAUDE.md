# 日刊預言者新聞（daily-prophet）

技術（朝刊）・社会課題（夕刊）のRSSダイジェストをLLMで要約し、LINEに1日2回自動配信するアプリ。加えて特定サイト（RSSのないウォッチ対象。URLはSecretsで指定しリポジトリには書かない）の新着記事を毎日チェックして別枠通知する。

## 背景・目的

技術動向・社会課題への知見を広げたいが、自発的に調べないとインプット機会がないため、朝夕の通知で強制的に読む機会を作る狙い。**目標管理システムとの連携やノルマ的な要素は意図的に入れていない**（続かなくなるため）。

**課金が発生する構成は避ける方針**（後述のGemini API採用の経緯を参照）。

## アーキテクチャ

```
scripts/
  sources.js          朝刊/夕刊のRSSソース一覧（URL付き）
  simple-rss.js        依存ゼロの自前RSS/Atom/RDFパーサー（fetchFeed）
  fetch-sources.js      RSS取得 + 時間窓フィルタ（fetchItems）
  seen-store.js         配信済みURLの記録・除外（loadSeen/addSeen、data/seen-{edition}.json）
  last-sent-store.js    当日JST基準の送信済みフラグ（wasSentToday/markSentToday、data/last-sent.json）
  build-digest.js       候補記事→Gemini APIで選定・要約→テキスト整形（buildDigest）
  fetch-thumbnails.js   選定記事のog:imageを取得してサムネイルURLを付与
  format-flex.js        ダイジェストをLINE Flex Message（カード形式カルーセル）に組み立て
  line.js               LINE Messaging API Broadcast送信（broadcastMessages/broadcastLine）
  notify-failure.js     ワークフロー失敗時のLINE通知（if: failure()から呼ばれる）
  send-digest.js        上記を繋ぐCLIエントリ。実際の送信とseen/last-sent更新はここでのみ行う
  fetch-site.js         ウォッチ対象サイト新着ページの専用パーサー（対象はWATCH_URL環境変数）
  check-site.js         サイト新着の差分検知・通知（data/site-seen.json）
.github/workflows/
  morning-digest.yml     朝刊を07:00 JSTに配信（02:00〜08:45 JSTに30/15分間隔でcron）
  evening-digest.yml     夕刊を17:00 JSTに配信（12:00〜18:45 JSTに30/15分間隔でcron）
  site-watch.yml         毎日07:13 JSTにウォッチ対象サイトの新着をチェック
data/
  seen-{morning,evening}.json  配信済み記事URL（直近300件）
  last-sent.json               各editionの最終送信日（JST）
  site-seen.json                サイトウォッチャーの既知URL一覧（SHA-256ハッシュ）
archive/
  YYYY-MM-DD-{edition}.md      配信済みダイジェストのテキスト版（振り返り用アーカイブ）
```

すべてNode.js標準機能のみで完結（外部npm依存なし）。`.env`はローカル実行用、GitHub Actionsでは repository の Secrets（`LINE_CHANNEL_ACCESS_TOKEN`, `GEMINI_API_KEY`, `WATCH_URL`, `WATCH_LABEL`）を使う。

## 主要な設計判断とその理由

- **朝刊＝技術、夕刊＝社会課題**（頭が疲れる夕方に技術記事は読みたくないという要望。逆にしないこと）
- **LLMはGemini API（`gemini-2.5-flash`、無料枠）を使用、Anthropic APIは使わない**。無課金運用の方針のため（Claude Pro契約はAPI従量課金を代替しない）。Google AI Studioでクレジットカード不要で無料発行できる。1日50回までの無料枠に対し実使用は1日2〜3回程度なので十分余裕がある
- **配信はLINE Messaging APIのBroadcast API**（`/v2/bot/message/broadcast`）。個人利用でuserId取得が不要なため
- **定時実行はGitHub Actionsの`schedule`トリガー**。Claude Code自体のスケジュール実行機能（`schedule`スキル等）はアプリが開いている時しか動かないため不採用
- **記事の重複防止は「配信済みURLの記録」方式**（`seen-store.js`）。当初は「過去N時間以内」の時間窓だけでフィルタしていたが、配信サイクル（24h）より窓を短くすると窓の隙間に落ちる記事が出る抜け漏れがあった。今は48時間の緩い候補プールを取得し、実際に送った記事だけをURL単位で除外する方式に統一
- **LLM出力は構造化JSON**（`generationConfig.responseMimeType: "application/json"`）で受け取り、LINE用テキストはコード側で整形する。これにより「実際に選ばれた記事のURL」を正確に取得してseen-storeに記録できる
- **定時配信は「cronをばらまき＋担当runが定刻まで待機」方式**。GitHub Actionsの`schedule`はGitHub公式が「混雑時に遅延する」と明言している仕様。外部cronサービス（cron-job.org等）は**第三者にGitHubトークンを渡す信頼関係を避けたいため不採用**。代わりに目標時刻の前後にcronを多数置き（朝は02:00〜07:00 JSTに30分間隔＋07:00〜08:45に15分間隔、夕も同様）、**どのrunが担当かは`send-digest.js`が起動時刻で判定する**。判定は`TARGET_TIME_JST`との差で3分岐:
  - 5時間より前に起動 → **何もせず終了**（後続のcronに任せる）
  - 5時間前〜目標時刻 → 担当。**定刻2分前までsleep→記事取得・生成→定刻ちょうどに送信**（生成を直前にやるのは、起動が数時間前でも記事の鮮度を保つため）
  - 目標を2時間まで超過 → 遅れて即送信。それ以上過ぎていたら送らない（深夜の夕刊配信を防ぐ）
  「1本の本命cronを早めに置く」方式（25分→62分→5時間と前倒し幅を広げてきた）は2026-08-27に破綻した。この日はGitHub側の遅延が8〜11時間に達し、実行の取りこぼしも発生。当時のコードは**窓を外れたら即送信**する作りだったため、(a)5時間超過して起動したrunが夕刊を22:50に配信、(b)13時間早く起動したrunが翌日分の夕刊を朝4時に配信し、さらに`last-sent`を埋めて本来の17時配信を潰す、という二重の事故になった。**窓を外れたrunは送信せず終了する**のが今の設計の要点
- 二重送信は同日重複配信ガード（`last-sent-store.js`）と、ワークフローの`concurrency`グループ（同時実行を直列化。担当runがsleepしている間に来たrunはpendingで待たされ、担当run完了後に`last-sent.json`を見て即終了する）の2段で防ぐ。cronをばらまいても実際に送るのは1日1本だけ
- **sleep中もActionsの実行時間としてカウントされる**。private時代は無料枠（月2,000分）の制約で25分前倒しが上限だった。public化（Actions無制限）に伴い今の設計が可能になっている。**このリポジトリをprivateに戻す場合は`MAX_EARLY_MINUTES`を25分以下にしてcronも減らさないと、無料枠を使い切って配信が全停止する**ので注意
- **読者像は「エンジニアではないが基本用語は分かる若手ビジネス職」**（2026-08-29にユーザー本人が指定）。朝刊はLLM・API・クラウド・機械学習といった**基本用語をいちいち説明しない**代わりに、実装の詳細や特定フレームワークの内部構造には踏み込まない。馴染みのない製品名・規格名・手法名が出たときだけ初出で補足し、最後に「これが効いてくる場面」を一言添える。関心ジャンルはAI・クラウド・実務で効いてくる技術
- **夕刊は曜日ごとにテーマを回して1週間で7ジャンルを一巡する**（`build-digest.js`の`EVENING_GENRES`。日=国際情勢・地政学／月=経済・金融／火=産業・企業／水=テクノロジーと社会／木=環境・エネルギー／金=人口・社会保障・医療／土=教育・労働）。毎回同じ切り口に偏らず視野を広げるのが狙いで、LINEの見出しも`夕刊（テクノロジーと社会）`のようにテーマ名になる。候補にテーマ該当記事が乏しい日は無理に当てはめず普通に選ばせる。**テーマを絞る分だけ情報源は偏りやすい**（実測で3本とも東洋経済になった日がある）ので、ソース追加時はこの点も見ること
- **夕刊の専門用語は従来どおり注釈つきで残す**（例:「リスキリング」「GX-ETS」）。経済・政策系の用語には慣れてほしいという意図
- **プロンプトに「複数の情報源から選ぶ」よう明記**。特定ソースへの偏り（夕刊が毎回RIETIばかりになる等）を防ぐため
- **要約はRSSのdescription（概要、最大300字に切り詰め）に基づかせる**。以前はタイトルとURLしかLLMに渡しておらず、要約がタイトルからの推測（創作）になっていた。`simple-rss.js`がdescription/summary/content:encodedを抽出し、プロンプトで「概要にない事実・数値を補わない」よう明示している
- **カードのサムネイルは記事ページのog:imageから取得**（`fetch-thumbnails.js`）。RSSに画像がないため、選定された2〜3記事だけ本文ページを取得してmetaタグから抜く。og:imageがないサイト（RIETI等）や取得失敗時は画像なしカードに自然に劣化する。サムネイルは飾りなので失敗しても配信は止めない
- **配信はFlex Message（記事ごとのカード形式カルーセル）、アーカイブはテキスト版**。LINEの課金は「1リクエスト（メッセージオブジェクト最大5個）＝1通」なので、見出しテキスト＋Flex＋警告は必ず1回のbroadcastにまとめる（無料枠は月200通、現状の使用は月70通程度）。メッセージ構造の検証は実送信せずに`/v2/bot/message/validate/broadcast`でできる
- **失敗時はLINEに通知**（`notify-failure.js`）。「通知が来ない＝新着なし」と「通知が来ない＝壊れている」を区別するため。各ワークフローの最後に`if: failure()`ステップがあり、Actionsのrun URLを添えて知らせる
- **配信したダイジェストは`archive/`にテキスト版で自動保存**（記事があった日のみ）。後から何を読んだか振り返るための資産。ワークフローのコミットステップが`archive`もaddする
- **LLMの選定結果は候補URL集合と突き合わせて検証**（`build-digest.js`）。LLMが候補にないURLを創作した場合に、壊れたリンクの配信や架空URLのseen記録を防ぐ。有効な記事が1本もなければエラーにして保険cronの再試行に委ねる
- **外部通信はすべてタイムアウト・リトライ付き**。フィード取得は20秒タイムアウト＋並行取得。Gemini呼び出しは60秒タイムアウト＋計4回試行で、**前半2回は`gemini-2.5-flash`、後半2回は`gemini-2.5-flash-lite`にフォールバック**する（2026-07-10朝、flashの容量逼迫＝503 high demandで配信が失敗した実績への対策。liteは容量プールが別なのでflashが混んでいても通りやすい）。LINE送信も30秒タイムアウト＋最大3回リトライで、`X-Line-Retry-Key`を同一にしてLINE側の重複排除を効かせている（429と5xxのみリトライ、他の4xxは即失敗）。ワークフロー自体にも`timeout-minutes`を設定し、ハングでランナーを浪費しない
- **git pushは競合時に`pull --rebase`して1回リトライ**。月曜朝など複数ワークフローがほぼ同時にdataをpushする場面があるため

## ハマった落とし穴

- **Google Driveの同期とnpm installが競合する**: このプロジェクトフォルダ（`G:\マイドライブ\claude_test\daily-prophet`）はGoogle Drive同期下にあり、`npm install`した`node_modules`のファイルが同期と競合して破損する（0バイトになる等、再インストールしても再現）。そのため外部npm依存を諦め、`simple-rss.js`に自前パーサーを実装している。**今後npm依存を追加する際は要注意**
- **RSSフィードは普通に死ぬ**: 当初候補にしていたWEF Agenda・Newsweek日本版のRSSは実際には配信終了していて404だった（検索結果や説明文だけを信じず、必ず実際にfetchして確認すること）
- **数値実体参照（`&#45;`等）のデコード漏れ**: GIGAZINEのRSSはURL中のハイフンを`&#45;`でエンコードしており、パーサー側で10進・16進の数値文字参照デコードを実装しないとリンクが壊れる
- **HTMLパースは`<li>`などのブロック単位でスコープを区切る**: ウォッチ対象サイトの新着ページパースで、正規表現が`<li>`をまたいで離れた要素同士（ナビのリンクと記事のタイトル）を誤って結びつけるバグがあった。要素を跨いで`[\s\S]*?`を使う場合は、まずブロック単位で分割してから中身を見ること
- **GitHub Developers Consoleの仕様変更**: Messaging APIチャネルは直接作成できず、先にLINE Official Account Managerでアカウントを作ってからMessaging APIを有効化する流れになっている
- **この環境に`gh` CLIが入っていない**: リポジトリ作成・Secrets登録・workflow_dispatchでの手動テストはGitHubのWeb UIで行う必要がある

## 現状

朝刊・夕刊・サイトウォッチ通知（毎日）すべて実装・自動化・実配信確認まで完了。リポジトリ: `https://github.com/kenshin3050/daily-prophet`（public運用）。

**このリポジトリはpublic**。2026-07-08にファイル・コミット履歴の両方から個人情報（本名メールアドレス等）を除去して履歴を作り直した。今後もコミットには本名メールを使わず、リポジトリローカルに設定済みのnoreplyアドレス（`101310167+kenshin3050@users.noreply.github.com`）を使うこと。個人的な背景・経緯はここには書かず、Claude Codeのメモリ側に記録する。

**ウォッチ対象サイトの名前・URLもリポジトリに書かない**。対象はSecrets/`.env`の`WATCH_URL`（通知の見出しは`WATCH_LABEL`）で渡し、コミットされる既知記事リスト（`data/site-seen.json`）は生URLではなくSHA-256ハッシュで保存する。コード・コミットメッセージ・ワークフロー名にも対象サイト名を書かないこと。

## 未着手・将来検討したいこと

- cronをばらまいても、GitHub側が「全cronを一律で数時間遅らせる／取りこぼす」日は担当窓に1本も入らず、その回は配信されない（遅すぎる配信よりスキップを選ぶ設計）。頻発するようなら、GitHubの`schedule`に依存しない外部トリガー（自分のCloudflare Workers Cron等からfine-grained PATで`workflow_dispatch`を叩く。`workflow_dispatch`は遅延しない）への移行を検討する
- ソースの追加・入れ替え（現状: 朝刊5・夕刊4）
- ウォッチ対象サイトの追加（RSSがないサイトはfetch-site.jsのようなスクレイピング実装が必要）
