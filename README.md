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
each or link by URL), ad sets (which ads run where, with their own targeting), the lead form
builder (greeting, custom questions with conditional logic, contact details, privacy policy,
thank-you page), and landing page settings (pixel, conversion objective and event). Drafts
autosave to the server and are shared with the team.

## Hermes agent

Launching a campaign and refreshing ad accounts go through the Hermes agent. Connect it in
the Settings tab (URL and API key, stored on the server) or with the `HERMES_URL` and
`HERMES_API_KEY` environment variables. Until it is connected, Launch and Refresh explain
that Hermes is not connected. The request shapes live in `lib/hermes.js` and can be
adjusted in one place once Hermes publishes its API:

- `POST {HERMES_URL}/campaigns` receives the campaign payload on launch
- `GET {HERMES_URL}/ad-accounts` returns accounts to merge into the Ad Accounts tab

Override the paths with `HERMES_LAUNCH_PATH` and `HERMES_ACCOUNTS_PATH` if they differ.

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
