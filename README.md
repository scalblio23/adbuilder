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

## Notes

- There is no login. Anyone with the URL can view and edit the accounts.
- The page refreshes the list every 5 seconds, so other people's edits appear without a reload.

## Files

- `public/` – the dashboard (HTML, CSS, sidebar script, Ad Accounts table script)
- `api/ad-accounts/` – Vercel serverless functions for the accounts API
- `lib/store.js` – storage: Postgres when `DATABASE_URL` is set, otherwise a JSON file
- `lib/handlers.js` – request handling shared by the Vercel functions and `server.js`
- `server.js` – standalone server for non-Vercel hosts and local use
- `Dockerfile` – container build
