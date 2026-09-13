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

## Hermes agent

The Hermes section at the bottom of the Ad Builder page handles both directions.

**AdBuilder calling Hermes** (Launch button, Refresh from Hermes, Test connection): enter the
Hermes URL and API key, choose how the key is sent (Bearer, X-API-Key, or both), and the
launch and test paths. Launch sends one `POST {url}{launchPath}` with:

```json
{ "prompt": "<plain-language brief of the whole campaign>",
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
- `api/` – Vercel serverless functions (ad accounts, campaigns, creatives, settings, hermes)
- `lib/db.js` – database connection (Neon HTTPS driver on Vercel, node-postgres elsewhere)
- `lib/store.js` – ad accounts storage: Postgres when `DATABASE_URL` is set, otherwise a JSON file
- `lib/docs.js` – document storage for campaigns, creatives, and settings
- `lib/handlers.js`, `lib/api.js` – request handling shared by the Vercel functions and `server.js`
- `lib/hermes.js` – Hermes agent integration
- `server.js` – standalone server for non-Vercel hosts and local use
- `Dockerfile` – container build
