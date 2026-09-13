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

**Direct Meta connection (recommended).** Paste a Meta access token with `ads_read` into the
"Meta connection" card at the bottom of the Campaigns tab (or set `META_ACCESS_TOKEN`). The app
then lists ad accounts and campaigns and pulls daily insights itself from the Marketing API,
campaign level and ad level, on Refresh and on the twice-daily cron. A System User token from Meta
Business Settings does not expire. The token is checked against `/me` before it is saved and is
never sent to the browser. Results follow what the ad sets are optimised for: the optimisation
goal and, for website conversions, the promoted event (Schedule, Lead, Purchase, Contact, …). Each
daily row also keeps the standard conversions it saw, so a campaign's result type can be changed on
its card (for example to Schedules) without pulling again; reach-optimised campaigns are shown but
left out of the combined result total. With no token the page falls back to asking Hermes, as
described below.


The Campaigns tab shows hand-picked Meta campaigns: metric cards at the top (revenue, profit,
Facebook stats, revenue vs cost, leads) and one row per campaign underneath. Only the campaigns
chosen there are ever pulled from Meta, to stay well inside the API rate limits.

1. **Choose campaigns**: step 1 ticks ad accounts (from the Meta catalog Hermes synced, or any
   Ads Manager link with `act=` in the Ad Accounts tab); "Pull campaigns" sends Hermes an
   `adbuilder.campaigns.sync` webhook naming those accounts, and Hermes replies with
   `PUT /api/v1/meta { campaigns: [{ id, name, adAccountId, adAccountName, status, objective }] }`
   (campaigns are merged per ad account). With no accounts known, `adbuilder.accounts.sync` asks
   for the account list instead. Step 2 ticks which campaigns show on the dashboard.
2. **Scheduled pulls**: `vercel.json` runs `/api/cron/stats` at 8:00 and 15:00 Adelaide time
   (daylight-saving times, 21:30 and 04:30 UTC; in winter they land at 7:00 and 14:00). Set
   `CRON_SECRET` in the Vercel project (any long random string) or the cron is refused.
3. **Refresh**: sends the same request on demand, at most once a minute.

Both send one `adbuilder.stats.refresh` webhook to Hermes (through the route above) listing only
the tracked campaigns and asking for a 60-day daily breakdown. Hermes pulls the insights and pushes
them back with the access token:

```
PUT /api/v1/campaign-stats
{ "items": [ { "campaignId": "1202…", "name": "…", "status": "ACTIVE", "objective": "OUTCOME_LEADS", "resultType": "Leads", "currency": "AUD",
               "daily": [ { "date": "2026-09-13", "spend": 0, "impressions": 0, "reach": 0, "clicksAll": 0, "linkClicks": 0, "results": 0, "leads": 0, "purchases": 0, "revenue": 0 } ],
               "ads": [ { "id": "…", "name": "…", "adSetName": "…", "status": "ACTIVE", "thumbnailUrl": "https://…",
                          "daily": [ { "date": "2026-09-13", "spend": 0, "impressions": 0, "reach": 0, "clicksAll": 0, "linkClicks": 0, "results": 0 } ] } ] } ] }
```

The page computes CPM, cost per link click, CTR (all), link CTR, frequency (impressions ÷ reach),
results and cost per result for the chosen timeframe (today, yesterday, last 7/14/30 days, this or
last month, maximum, or a custom range) from those daily rows, and shows the ad-by-ad breakdown
under each campaign. Frequency over a range is approximate because daily reach is summed.

`GET /api/v1/campaign-stats` returns the tracked list, so Hermes can also pull on its own schedule.
Campaigns that are not tracked are ignored. The page polls for the new numbers after a refresh.

## Hermes agent

The Hermes section at the bottom of the Ad Builder page handles both directions.

**AdBuilder calling Hermes** (Launch, Refresh, Pull campaigns, Test connection): Hermes
receives webhooks on `WEBHOOK_PORT` (8644) and verifies each request against the
`WEBHOOK_SECRET` in its `.env`. The same value must be in AdBuilder: in the Hermes card's
"Send to Hermes" section either paste Hermes' existing `whsec_…` secret ("Use this secret") or
press "Generate secret" and put the shown value into Hermes' `.env`. Do not put the secret in
`config.yaml`; a route-level secret overrides the global one. The route itself:

```yaml
platforms:
  webhook:
    enabled: true
    extra:
      port: 8644
      routes:
        adbuilder:
          prompt: |
            {prompt}

            AdBuilder campaign ID: {campaignId}
          toolsets: ["terminal", "file", "web"]   # add the toolset that holds your Meta Ads tools
          deliver: "log"                          # each request becomes a new chat in the Hermes dashboard
```

Restart the Hermes gateway, enter the public address of the Hermes server ending in
`/webhooks/adbuilder` as the webhook URL, Save, and Test connection. Hermes answers `202` once it
has accepted the request; the run then appears as a new chat in the Hermes dashboard (source:
webhook). Webhook runs default to a read-only toolset; `toolsets` must include whatever Hermes
needs to create Meta campaigns and to call back into AdBuilder.

Requests are signed the Svix way: the body is serialized once, a unique `svix-id` (`msg_…`) and
`svix-timestamp` (Unix seconds) are sent, and `svix-signature: v1,<base64>` is the HMAC-SHA256
over `<svix-id>.<svix-timestamp>.<body>` keyed with the base64-decoded secret (the part after
`whsec_`). Hermes keys idempotency and the dashboard session on `svix-id`, so every new request
gets a new id. Every body carries `prompt` and `campaignId` (the route template uses both) plus
`event_type` (`adbuilder.test`, `adbuilder.campaign.launch`, `adbuilder.stats.refresh`,
`adbuilder.campaigns.sync`, `adbuilder.accounts.sync`). Failed deliveries are logged server-side
with status, response, `svix-id`, time, URL and payload size; the secret and signature are never
logged. Bearer and X-API-Key modes remain for receivers that expect a plain key. Launch sends one
`POST` with:

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
- `api/index.js` – the single Vercel function (`vercel.json` rewrites every `/api/*` path to it); `lib/router.js` holds the route table it and `server.js` share
- `lib/db.js` – database connection (Neon HTTPS driver on Vercel, node-postgres elsewhere)
- `lib/store.js` – ad accounts storage: Postgres when `DATABASE_URL` is set, otherwise a JSON file
- `lib/docs.js` – document storage for campaigns, creatives, and settings
- `lib/handlers.js`, `lib/api.js` – request handling shared by the Vercel functions and `server.js`
- `lib/hermes.js` – Hermes agent integration
- `server.js` – standalone server for non-Vercel hosts and local use
- `Dockerfile` – container build
