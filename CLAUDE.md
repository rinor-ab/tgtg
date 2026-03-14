# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Too Good To Go (TGTG) — a React PWA for food rescue/waste prevention in St. Gallen. Mobile-first, deployed on Vercel, no backend (mock data in `src/mockDb.js`).

## Commands

- `npm run dev` — Start Vite dev server with HMR
- `npm run build` — Production build to `/dist`
- `npm run lint` — ESLint (flat config, ESLint 9.x)
- `npm run preview` — Preview production build locally
- `npx vercel --prod` — Deploy to Vercel production

## Tech Stack

- **React 19** with JSX (no TypeScript)
- **Vite 7** as build tool
- **Tailwind CSS 4** via `@tailwindcss/vite` plugin
- **Leaflet + React-Leaflet** for interactive maps
- **ESLint 9** flat config format (`eslint.config.js`)
- No test framework configured

## Architecture

The app is a single-page PWA with five tabs: Home, Browse, Quest, Favourites, Profile.

**Key source files:**
- `src/App.jsx` — Main component (~2500 lines). Contains all UI views, state management via React hooks, gamification logic (tiers, eco points, quests, badges), and CO₂ impact tracking.
- `src/LeafletMap.jsx` — Map component with custom markers, clustering, transparency cards, and live feed.
- `src/TagDataContext.jsx` — React Context for global state with `localStorage` persistence (tagData, ecoPoints, claimedQuests, redeemedRewards, lifetimePoints).
- `src/mockDb.js` — Store data (names, coordinates, prices, categories, images, tag distributions) for St. Gallen locations.
- `src/index.css` — Tailwind imports + custom theme colors, animations, and PWA standalone adjustments.

**State management:** React Context (`TagDataContext`) + component-level `useState`/`useEffect`. All persistent data stored in `localStorage`.

## PWA Setup

- Service worker: `public/sw.js` (network-first caching, cache name `tgtg-v1`)
- Manifest: `public/manifest.webmanifest` (standalone display mode)
- Theme color: `#1A4D3A`
- Custom Tailwind colors: `tgtg-green (#5BAD92)`, `tgtg-dark (#1A3C34)`, `tgtg-orange (#F59316)`, `tgtg-bg (#F5F3EE)`

## Static Assets

Store images and logos live in `public/stores/`. App icons in `public/icons/`.
