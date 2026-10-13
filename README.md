# Iskra

[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen?style=flat-square)](/LICENSE)

An RSS / Atom reader that lets you add feeds on your phone and read the latest articles on Even G2. The phone UI lets you add, remove, and refresh feeds, and read article content. On G2, you can browse the article list and page through article content.

[日本語](README.ja.md)

## Development

```sh
npm install
npm run dev
```

The browser shows the phone feed-management UI and a G2 display preview. To run the emulator, start it in a separate terminal:

```sh
npm run simulator
```

In the emulator's Browser window, add `http://localhost:5173/simulator-feed.xml` to try a two-article feed, sorted newest first, and page through the article content. In the Glasses Display window, use Up and Down to select an article, Click to open it, and Double Click to return to the list. Long Press in the list refreshes the feed.

## Display language

Choose the display language from the selector below the feed settings. The default is English. Supported languages are English, Simplified Chinese, Traditional Chinese, Japanese, Spanish, French, German, Italian, and Korean. Your choice is saved on the device and in Even Hub app storage, and is used for both the phone UI and G2 article text.

In the emulator, you can also temporarily override the saved choice with the `?lang=` URL parameter (for example, `http://localhost:5173/?lang=en`, `?lang=zh-Hant`, or `?lang=ja`). Supported values are `en`, `zh-Hans`, `zh-Hant`, `ja`, `es`, `fr`, `de`, `it`, and `ko`. Changing the selector removes the URL override and saves the new choice.

## Privacy

The app's privacy policy is available in English and Japanese at [`public/privacy.html`](public/privacy.html) and from the in-app footer. Before publication, host the policy at a public HTTPS URL and add that URL to the Even Hub listing.

To access the browser UI from the emulator, start the dev server with `npm run dev -- --host 0.0.0.0`. For on-device testing, use Even Hub's local testing flow:

```sh
npm run dev -- --host 0.0.0.0
evenhub qr --url "http://<your-computer's-LAN-IP>:5173"
```

Scan the QR code from Even Hub in the Even Realities app. To package the app, use the Even Hub CLI:

```sh
evenhub pack app.json dist -o iskra.ehpk
```

## Feed fetching and CORS

All feeds are fetched through a Cloudflare Worker; the app does not access feed providers directly. This avoids browser CORS restrictions, and the Worker controls which source hosts are allowed. `permissions.network` in `app.json` grants the app network access to the Worker.

In the phone UI, users can set their own Worker URL under “RSS Fetch Worker.” The Worker must accept `GET ?url=<feed URL>` and return RSS / Atom XML with CORS headers. The URL is saved on that device and used for feed requests. “Reset to default” restores the default Worker URL provided at package build time through `VITE_RSS_PROXY_URL`. If no Worker URL is configured, feed fetching is disabled; the app does not fall back to direct requests.

You can deploy the included `proxy/worker.js` to Cloudflare Workers for a personal Worker with the same interface. `ALLOWED_FEED_HOSTS = "*"` in `proxy/wrangler.toml` allows all domains (the Worker still rejects localhost and IP addresses).

A Worker with no domain restrictions is a public proxy that can be used by anyone who knows its URL. For public deployments, restrict `ALLOWED_FEED_HOSTS` to trusted feed hosts to reduce abuse and unexpected traffic.

### Try it in the emulator

You do not need to deploy to Cloudflare. Start a local Worker in a separate terminal, set its URL in `.env.local`, and restart Vite:

```sh
npm install --save-dev wrangler
npx wrangler dev --config proxy/wrangler.toml --port 8787
```

```sh
echo 'VITE_RSS_PROXY_URL=http://localhost:8787/' > .env.local
npm run dev
```

### On-device testing and distribution

```sh
npm install --save-dev wrangler
npx wrangler login
npx wrangler deploy --config proxy/wrangler.toml

cp .env.example .env.local
# Set VITE_RSS_PROXY_URL in .env.local to the deployed Worker URL
npm run dev
```

Set `VITE_RSS_PROXY_URL` in `.env.local` to the deployed Worker URL and run `npm run build` before packaging. If users should be able to specify arbitrary Worker URLs in the app, `permissions.network` in `app.json` must allow those Worker domains. To allow different domains per user, keep the current `"*"` setting. If you share a public Worker broadly, restrict `ALLOWED_FEED_HOSTS` in `proxy/wrangler.toml` to the feed hosts you trust.

Feed subscriptions and fetched articles are stored on the device. In Even Hub, they are also stored in the SDK's app storage and synchronized with the G2 display. On the glasses, use Up and Down to select an article and Click to open it. Article content is split into pages; use Click or Up/Down to move between pages. Double Click returns to the list.
