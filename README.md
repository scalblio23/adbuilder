# AdBuilder Dashboard

A simple dark grey dashboard with a collapsible sidebar. Plain HTML, CSS, and JavaScript with no build step.

## Run

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8080
```

Then visit http://localhost:8080.

## Hosted version

`dashboard.html` is the single-file version published on claude.ai. Its Ad Accounts
table uses the hosted page's shared database, so everyone who opens the link sees and
edits the same list. Republish that file to update the hosted page.

## Files

- `index.html` – page structure (sidebar, top bar, content sections)
- `styles.css` – dark grey theme and layout
- `app.js` – sidebar collapse and section navigation
- `ad-accounts.js` – editable Ad Accounts table (add, edit, delete), saved in the browser's local storage (local version only)
- `dashboard.html` – hosted single-file version with shared Ad Accounts storage
