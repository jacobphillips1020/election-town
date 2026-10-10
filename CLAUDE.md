# Prototype guidelines

This is a lightweight personal prototype, not a production app. The person working
here is a product manager, not a professional developer: explain things briefly and
in plain language, and don't assume terminal knowledge.

## Principles

- **Keep things simple.** Choose the smallest thing that works.
- **Prefer a single HTML file** (HTML + CSS + JS in `index.html`). Only step up to a
  small **Vite + React** app when the prototype really needs components or state
  that a single file can't handle cleanly.
- **No backend unless I ask for one.** No servers, databases or API keys by default.
  Use hard-coded sample data or `localStorage`.
- **Mobile-friendly by default.** Include the viewport meta tag, use responsive
  layouts, and make tap targets comfortably large.
- **Commit to git often.** Make a small commit after each meaningful change with a
  clear message, so it's easy to go back.

## Practical notes

- Never commit secrets, passwords or API keys.
- Keep dependencies to a minimum.
- If using Vite + React, create it in this folder with `npm create vite@latest . -- --template react`.
- To run locally: open `index.html` in a browser (single file), or `npm run dev`
  (Vite).
- This repo is meant to deploy as a static site (Vercel or Netlify).
