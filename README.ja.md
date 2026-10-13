# Even RSS

[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen?style=flat-square)](/LICENSE)

スマホで登録したRSS / Atomフィードを、Even G2で新しい順に読めるリーダーです。スマホではフィードの追加・削除・更新と記事本文を表示し、G2では記事一覧から本文をページ送りできます。

[English](README.md)

## 開発

```sh
npm install
npm run dev
```

ブラウザではスマホ用の管理画面とG2表示プレビューを確認できます。G2画面をエミュレートする場合は別ターミナルで実行します。

```sh
npm run simulator
```

エミュレーターのBrowserウィンドウで`http://localhost:5173/simulator-feed.xml`を登録すると、2件の記事の新着順表示と本文ページ送りを試せます。Glasses Displayウィンドウでは上下で記事を選び、クリックで本文、ダブルクリックで一覧へ戻ります。一覧を長押しするとフィードを更新できます。

## 表示言語

フィード設定の下にある表示言語の選択欄から変更できます。初期設定はEnglishです。English、简体中文、繁體中文、日本語、Español、Français、Deutsch、Italiano、한국어に対応し、選択した言語は端末とEven Hubのアプリ用ストレージに保存され、スマホUIとG2上の記事表示に反映されます。

エミュレーターではURLの`?lang=`で保存済みの設定を一時的に上書きできます（例: `http://localhost:5173/?lang=en`、`?lang=zh-Hant`、`?lang=ja`）。指定できる値は`en`、`zh-Hans`、`zh-Hant`、`ja`、`es`、`fr`、`de`、`it`、`ko`です。選択欄を変更するとURL上書きが解除され、新しい言語が保存されます。

## プライバシー

プライバシーポリシーは英語・日本語で[`public/privacy.html`](public/privacy.html)にあり、アプリ内フッターからも開けます。公開前にHTTPSで一般公開し、Even Hubの掲載情報にURLを登録してください。

ブラウザー側を`npm run dev -- --host 0.0.0.0`で起動すると、エミュレーターでも同じ画面を確認できます。実機ではEven Hubのローカルテストを使います。

```sh
npm run dev -- --host 0.0.0.0
evenhub qr --url "http://<パソコンのLAN IP>:5173"
```

Even RealitiesアプリのEven HubからQRコードを読み取ります。アプリをパッケージする場合はEven Hub CLIを使います。

```sh
evenhub pack app.json dist -o even-rss.ehpk
```

## フィード取得とCORS

フィードの取得はすべてCloudflare Worker経由で行い、アプリから配信元へ直接アクセスしません。ブラウザーのCORS制限に左右されず、配信元ホストへの許可もWorker側で管理できます。`app.json`の`permissions.network`はWorkerへの通信を許可する設定です。

アプリにはスマホ側の「RSS取得Workerを設定」から、利用者自身のWorker URLを設定できます。Workerは`GET ?url=<フィードURL>`を受け取り、RSS / Atom XMLとCORSヘッダーを返す必要があります。設定はその端末内に保存され、アプリからのフィード取得に使われます。「デフォルトに戻す」を押すと、パッケージ作成時に`VITE_RSS_PROXY_URL`で指定された既定Workerに戻ります。未設定の場合はフィードを取得せず、直接アクセスへのフォールバックもしません。

付属の`proxy/worker.js`をCloudflare Workerにデプロイすれば、同じ仕様の個人用Workerとして利用できます。`proxy/wrangler.toml`の`ALLOWED_FEED_HOSTS = "*"`はすべてのドメインを許可します（localhostやIPアドレスはWorker側で拒否します）。

ドメイン制限のないWorkerは、URLを知る第三者も利用できる公開プロキシになります。公開環境で使う場合は、悪用や予期しない通信量を避けるため、`ALLOWED_FEED_HOSTS`を信頼できるフィードのホスト名に絞ってください。

### エミュレーターで試す

Cloudflareへのデプロイは不要です。別ターミナルでローカルWorkerを起動し、`.env.local`にURLを指定してからViteを再起動します。

```sh
npm install --save-dev wrangler
npx wrangler dev --config proxy/wrangler.toml --port 8787
```

```sh
echo 'VITE_RSS_PROXY_URL=http://localhost:8787/' > .env.local
npm run dev
```

### 実機・配布用

```sh
npm install --save-dev wrangler
npx wrangler login
npx wrangler deploy --config proxy/wrangler.toml

cp .env.example .env.local
# .env.local の VITE_RSS_PROXY_URL にデプロイしたWorkerのURLを設定
npm run dev
```

`.env.local`の`VITE_RSS_PROXY_URL`にデプロイ後のWorker URLを設定し、パッケージする前に`npm run build`してください。利用者がアプリ内で任意のWorker URLを指定できるようにするには、`app.json`の`permissions.network`でそのWorkerのドメインを許可する必要があります。利用者ごとに異なるドメインを許可する場合は、現在の`"*"`を維持してください。公開Workerを広く共有する場合は、`proxy/wrangler.toml`の`ALLOWED_FEED_HOSTS`を許可するフィードのホスト名に絞ってください。

フィード一覧と取得記事は端末内に保存します。Even Hub上ではSDKのアプリ用ストレージにも保存して、G2表示と同期します。グラスでは上下操作で記事を選び、タップで本文を開きます。本文はページ分割され、タップまたは上下操作でページを切り替えます。ダブルタップで一覧へ戻ります。
