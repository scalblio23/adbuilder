# AdBuilder Dashboard

A dark grey dashboard with a collapsible sidebar. The Ad Accounts tab is editable and
shared: the server stores the accounts, so everyone who opens the site sees the same list.

Plain HTML, CSS, and JavaScript on the front end and a dependency-free Node server.

## Run locally

```sh
npm start
```

Then open http://localhost:8080. Ad accounts are saved to `data/ad-accounts.json`.

## Deploy to a shared server

The app is a single Node process, so any host that runs Node or Docker works.
It needs one thing from the host: a persistent folder for `DATA_DIR`, otherwise the
accounts are lost when the host restarts or redeploys.

| Setting    | Value                                   |
|------------|-----------------------------------------|
| Start      | `npm start`                             |
| Port       | `PORT` (set by most hosts automatically)|
| Data folder| `DATA_DIR`, for example `/data`         |

Examples:

- **Railway**: create a project from this repo, add a Volume mounted at `/data`, and set
  the `DATA_DIR` variable to `/data`.
- **Fly.io**: `fly launch`, then `fly volumes create data` and mount it at `/data`. The
  included `Dockerfile` already sets `DATA_DIR=/data`.
- **Render**: create a Web Service from this repo with a Disk mounted at `/data` and set
  `DATA_DIR=/data`. Free web services have no disk, so pick a plan that includes one.
- **Any VPS with Docker**: `docker build -t adbuilder . && docker run -p 80:8080 -v adbuilder-data:/data adbuilder`

Share the resulting URL with your team. Note that the site has no login: anyone with the
URL can view and edit the accounts.

## Files

- `index.html` – page structure (sidebar, top bar, content sections)
- `styles.css` – dark grey theme and layout
- `app.js` – sidebar collapse and section navigation
- `ad-accounts.js` – editable Ad Accounts table, saved through the server API
- `server.js` – serves the site and the `/api/ad-accounts` API, storing data as JSON
- `Dockerfile` – container build for hosts that run Docker
