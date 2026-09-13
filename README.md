# AdBuilder Dashboard

A dark grey dashboard with a collapsible sidebar. The Ad Accounts tab is editable and
shared: accounts are stored on the server, so everyone who opens the site sees the same list.

Front end is plain HTML, CSS, and JavaScript in `public/`. The API lives in `lib/` and is
exposed two ways: as Vercel serverless functions in `api/`, or by `server.js` for hosts that
run a Node process.

## Deploy on Vercel (recommended)

Vercel has no persistent disk, so the accounts need a database.

1. In Vercel, import this repository as a new project. Leave the framework preset as
   **Other** and deploy.
2. Open the project's **Storage** tab, click **Create Database**, and choose **Neon**
   (Postgres) with the free plan. Connect it to the project. This sets `DATABASE_URL`
   automatically.
3. Redeploy (Deployments tab, then Redeploy on the latest one).

The table is created on first use. Share the site URL with your team.

## Other hosts (Railway, Fly.io, Render, Docker)

Run `npm start`. If `DATABASE_URL` is set the app uses Postgres; otherwise it saves to
`DATA_DIR/ad-accounts.json` (default `./data`), which needs a persistent volume.

```sh
docker build -t adbuilder . && docker run -p 80:8080 -v adbuilder-data:/data adbuilder
```

## Run locally

```sh
npm install
npm start
```

Open http://localhost:8080. Without a database, accounts go to `data/ad-accounts.json`.

## Ad Builder

The Ad Builder tab creates campaign drafts in nine steps: ad copy, headlines, destination
(landing page or instant lead form), targeting, ad account, creatives (upload up to 3.5 MB
each, paste links one per line, or pick from the swipe file), ad sets (which ads run where, with their own targeting), the lead form
builder (greeting, custom questions with conditional logic, contact details, privacy policy,
thank-you page), and landing page settings (pixel, conversion objective and event). Drafts
autosave to the server and are shared with the team.

## Creative Swipe File

The Swipe File tab is a gallery of Meta Ad Library creatives that Hermes collects. The simplest
way in is one call per ad, `POST /api/creatives/import` (also at `/api/v1/creatives/import`),
key-protected, as `multipart/form-data`:

```sh
curl -H "Authorization: Bearer $ADBUILDER_API_KEY" \
  -F "media=@ad.mp4;type=video/mp4" -F "thumbnail=@ad.jpg;type=image/jpeg" \
  -F 'metadata={"libraryId":"1234567890123","advertiser":"Nike","copy":"…","headline":"…","cta":"Shop now","landingUrl":"https://…","ranking":4,"startedAt":"2026-08-01","active":true}' \
  https://your-site/api/creatives/import
```

It stores the media (deduped by SHA-256), the optional thumbnail, and the metadata, and returns
`{ record, url, thumbnailUrl, media: {id, hash, duplicate}, dedupe }`. A JSON body works too:
`{ media: {name, mime, data: base64} | {url}, thumbnail: {…}, metadata: {…} }`. Media over
3.5 MB must be passed as `metadata.mediaUrl` instead of uploaded.

The two-step alternative: upload with `POST /api/v1/creatives` (base64; the reply carries a
permanent `url` and a `hash`, and identical bytes return the existing record), then upsert the
metadata with `PUT /api/v1/swipes`:

```json
{ "items": [ { "libraryId": "1234567890123", "advertiser": "Nike", "mediaType": "image",
  "mediaUrl": "https://your-site/api/creatives/<id>", "mediaHash": "<sha256 from the upload>",
  "thumbnailUrl": "", "copy": "…", "headline": "…", "cta": "Shop now",
  "landingUrl": "https://…", "ranking": 4, "libraryPosition": 1, "startedAt": "2026-08-01", "active": true } ] }
```

`libraryPosition` is where the ad sat in the Ad Library results when Hermes saw it (1 = top-left,
usually the best performer). The page shows it as a badge, sorts by it by default, and records
when it was last observed.

Records are stored in the `documents` table (collection `swipes`, id = Library ID) with first
and last seen timestamps. Duplicates are handled two ways: the same Library ID updates the
existing record, and a different Library ID with the same media hash is merged into the
existing record as an alias. `GET /api/v1/swipes` returns saved IDs and hashes so Hermes can
skip work. The page renders images and videos, filters by advertiser, media type, and active
state, searches copy, and lets you rank, toggle active, or delete. Meta-style field names
(`page_name`, `media_url`, `is_active`) are accepted.

### Creative links

In step 6, paste one URL per line into the Creative links box. Each line is added as a creative
automatically; removing a line detaches it from the campaign. Google Drive share links are
converted to direct download links (with a thumbnail) and Dropbox links get `dl=1`, so Hermes can
fetch the files. Share Drive and Dropbox files with "anyone with the link". Files over 3.5 MB
should be linked this way rather than uploaded.

## AI brain

"Let AI build" at the top of Ad Builder turns a short brief into copy, headlines, targeting,
lead form questions, and ad set names, all editable. Steps 1 and 2 also have Generate buttons.
It uses an OpenAI API key from platform.openai.com, entered under AI settings at the bottom of
Ad Builder (or the `OPENAI_API_KEY` environment variable; `OPENAI_MODEL` sets the default model).
The key stays on the server. Usage is billed per request to your OpenAI account.

The rules that decide what the AI reads and writes (for example, headlines derive from the
primary text already typed) are listed in `AI_RULES.md` and inside the AI settings card.

## Campaigns tab (live numbers)

The Campaigns tab shows hand-picked Meta campaigns: metric cards at the top (revenue, profit,
Facebook stats, revenue vs cost, leads) and one row per campaign underneath. Only the campaigns
chosen there are ever pulled from Meta, to stay well inside the API rate limits.

1. **Choose campaigns**: tick campaigns from the list Hermes synced (`PUT /api/v1/meta` with
   `{ campaigns: [{ id, name, adAccountId, adAccountName, status, objective }] }`) or add one by ID.
2. **Scheduled pulls**: `vercel.json` runs `/api/cron/stats` at 8:00 and 15:00 Adelaide time
   (daylight-saving times, 21:30 and 04:30 UTC; in winter they land at 7:00 and 14:00). Set
   `CRON_SECRET` in the Vercel project (any long random string) or the cron is refused.
3. **Refresh**: sends the same request on demand, at most once a minute.

Both send one `adbuilder.stats.refresh` webhook to Hermes (through the route above) listing only
the tracked campaigns and asking for a 60-day daily breakdown. Hermes pulls the insights and pushes
them back with the access token:

```
PUT /api/v1/campaign-stats
{ "items": [ { "campaignId": "1202…", "name": "…", "status": "ACTIVE", "currency": "AUD",
               "daily": [ { "date": "2026-09-13", "spend": 0, "impressions": 0, "reach": 0, "clicks": 0, "leads": 0, "purchases": 0, "revenue": 0 } ] } ] }
```

`GET /api/v1/campaign-stats` returns the tracked list, so Hermes can also pull on its own schedule.
Campaigns that are not tracked are ignored. The page polls for the new numbers after a refresh.

## Hermes agent

The Hermes section at the bottom of the Ad Builder page handles both directions.

**AdBuilder calling Hermes** (Launch button, Refresh from Hermes, Test connection): Hermes
receives webhooks on `WEBHOOK_PORT` (8644) and verifies each request with the route's secret.
In the Hermes card's "Send to Hermes" section, press "Generate secret": AdBuilder creates the
`WEBHOOK_SECRET`, shows it once, and signs everything it sends with it. The card also shows the
route to add to `~/.hermes/config.yaml` (copy it while the secret is visible):

```yaml
platforms:
  webhook:
    enabled: true
    extra:
      port: 8644
      routes:
        adbuilder:
          secret: "<the generated WEBHOOK_SECRET>"
          events: ["adbuilder.campaign.launch", "adbuilder.stats.refresh", "adbuilder.test"]
          prompt: |
            {prompt}

            AdBuilder campaign ID: {campaignId}
          toolsets: ["terminal", "file", "web"]   # add the toolset that holds your Meta Ads tools
          deliver: "telegram"                     # telegram, discord, slack, … ("log" only writes to the gateway log)
```

Restart the Hermes gateway, expose its port publicly (for example `ngrok http 8644`), enter
`https://<tunnel>/webhooks/adbuilder` as the webhook URL, Save, and Test connection. A webhook
run never appears as a chat session in Hermes: the agent's reply is sent to the route's
`deliver` target, so set that to the platform you talk to Hermes on. Webhook runs default to a
read-only toolset; `toolsets` must include whatever Hermes needs to create Meta campaigns.

Requests are signed with HMAC SHA-256 over the exact body, in both forms Hermes accepts:
`X-Hub-Signature-256: sha256=…` (GitHub style) and `X-Webhook-Signature-V2` over
`<timestamp>.<body>` with `X-Webhook-Timestamp`. Each request carries a unique `X-Request-ID`
(and `X-GitHub-Delivery`) so a retry never starts a second run, plus `X-GitHub-Event` /
`X-Event-Type` and a body field `event_type` (`adbuilder.test` or `adbuilder.campaign.launch`)
for the route's `events` filter. Bearer and X-API-Key modes remain for receivers that expect a
plain key. Launch sends one `POST` with:

```json
{ "event_type": "adbuilder.campaign.launch",
  "campaignId": "…",
  "prompt": "<plain-language brief of the whole campaign>",
  "campaign": { ...structured data... },
  "assets": [ { "name": "hero.png", "type": "image", "url": "https://your-site/api/creatives/<id>" } ],
  "account": { "client": "...", "company": "...", "link": "..." } }
```

Preview shows exactly what will be sent. Asset links are public so Hermes can download them;
set "Public base URL" if the site is reached through a different address than the one users
open. Environment variables `HERMES_URL`, `HERMES_API_KEY`, `HERMES_AUTH`, `HERMES_LAUNCH_PATH`,
`HERMES_TEST_PATH`, `HERMES_TEST_METHOD`, and `PUBLIC_BASE_URL` override the saved settings.

**Hermes calling AdBuilder**: generate an `ADBUILDER_API_KEY` in the same section and paste it
into Hermes. It is shown once and stored hashed. With it, Hermes can call
(`Authorization: Bearer <key>` or `X-API-Key: <key>`):

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/ping` | Check the key |
| `GET /api/v1/campaigns` | Campaigns with status |
| `GET /api/v1/campaigns/{id}` | Full launch payload (prompt, campaign, assets) |
| `POST /api/v1/campaigns/{id}/status` | Report `{ status, message, externalId }` back |
| `PUT /api/v1/meta` | Sync the Meta catalog: `{ adAccounts: [{id,name}], pixels: [{id,name}], pages: [{id,name}] }` |

Hermes reads ad accounts, pixels/datasets, and pages with its Meta access token and sends them
to `PUT /api/v1/meta`. They then appear as dropdowns in Ad Builder steps 5 and 9. Meta-style
field names (`account_id`, `ad_accounts`, `datasets`) are accepted too.
| `GET /api/creatives/{id}` | Image or video bytes |

## Notes

- There is no login. Anyone with the URL can view and edit the accounts.
- The page refreshes the list every 5 seconds, so other people's edits appear without a reload.

## Files

- `public/` – the dashboard (HTML, CSS, sidebar, Ad Accounts table, Ad Builder, Settings)
- `api/[...path].js` – the single Vercel function; `lib/router.js` holds the route table it and `server.js` share
- `lib/db.js` – database connection (Neon HTTPS driver on Vercel, node-postgres elsewhere)
- `lib/store.js` – ad accounts storage: Postgres when `DATABASE_URL` is set, otherwise a JSON file
- `lib/docs.js` – document storage for campaigns, creatives, and settings
- `lib/handlers.js`, `lib/api.js` – request handling shared by the Vercel functions and `server.js`
- `lib/hermes.js` – Hermes agent integration
- `server.js` – standalone server for non-Vercel hosts and local use
- `Dockerfile` – container build
