# TUNESF tournament site

## Run locally

Install Node.js 20.19+ or 22.12+, then from the repository root run:

```sh
npm install
npm run dev
```

Open http://127.0.0.1:8000. Vite refreshes the browser when source files change.

## Source layout

- Pages: `tunesf-tournament-site-main/src/*.html`
- JavaScript: `tunesf-tournament-site-main/src/public/js/`
- Styles: `tunesf-tournament-site-main/src/public/css/`
- Other static assets: `tunesf-tournament-site-main/src/public/`
- Supabase migrations: `supabase/migrations/`

Edit the source files; `dist/` is the built website committed for static hosting. Vite writes its build output to `tunesf-tournament-site-main/dist/`, as configured for Vercel.

## Build and preview

```sh
npm run build
npm run preview
```

The preview server runs at http://127.0.0.1:4173.

The browser app connects to the configured Supabase project. Running Vite does not start a local database.
