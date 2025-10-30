// index.js — Stremio add-on: "90s–2010s Movies"
// Catalog-only (no streams). Uses TMDb for metadata.
// Requirements: Node 18+, `npm i stremio-addon-sdk node-fetch`
// Set TMDB_API_KEY in your environment (or .env) before running.

import { addonBuilder, serveHTTP } from "stremio-addon-sdk";
import fetch from "node-fetch";

const TMDB_API_KEY = process.env.TMDB_API_KEY;
if (!TMDB_API_KEY) {
  console.warn("[WARN] TMDB_API_KEY is not set. Add it to your env before starting.");
}

// ----- Manifest -----
const manifest = {
  id: "org.josh.classics_90s_2010s",
  version: "1.1.0",
  name: "90s–2010 (By Decade)",
  description: "Curated catalogs split by decade: 1990s and 2000s–2010. Metadata only; pair with your favorite streaming add-ons.",
  types: ["movie"],
  resources: ["catalog", "meta"],
  catalogs: [
    {
      type: "movie",
      id: "nineties",
      name: "1990s Movies",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false },
        { name: "genre", options: [
          "action", "adventure", "animation", "comedy", "crime", "drama", "family", "fantasy", "history", "horror", "music", "mystery", "romance", "science fiction", "tv movie", "thriller", "war", "western"
        ], isRequired: false },
        { name: "sort", options: ["popularity", "rating", "release"], isRequired: false }
      ]
    },
    {
      type: "movie",
      id: "two_thousands",
      name: "2000s–2010 Movies",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false },
        { name: "genre", options: [
          "action", "adventure", "animation", "comedy", "crime", "drama", "family", "fantasy", "history", "horror", "music", "mystery", "romance", "science fiction", "tv movie", "thriller", "war", "western"
        ], isRequired: false },
        { name: "sort", options: ["popularity", "rating", "release"], isRequired: false }
      ]
    }
  ]
};

const builder = new addonBuilder(manifest);

// ----- Helpers -----
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG = (path, size = "w500") => (path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined);

const mapGenreToId = (name) => {
  // TMDb genre IDs (movies)
  const ids = {
    action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80,
    documentary: 99, drama: 18, family: 10751, fantasy: 14, history: 36,
    horror: 27, music: 10402, mystery: 9648, romance: 10749,
    "science fiction": 878, thriller: 53, war: 10752, western: 37,
    "tv movie": 10770
  };
  return ids[name?.toLowerCase?.()] || undefined;
};

function tmdbHeaders() {
  return { "accept": "application/json" };
}

async function tmdb(path, params = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", TMDB_API_KEY || "");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: tmdbHeaders() });
  if (!res.ok) throw new Error(`TMDb ${res.status}: ${await res.text()}`);
  return res.json();
}

// Convert TMDb movie to Stremio meta preview
function toMetaPreview(m) {
  return {
    id: `tmdb:${m.id}`,
    type: "movie",
    name: m.title,
    poster: IMG(m.poster_path),
    background: IMG(m.backdrop_path, "w780"),
    releaseInfo: (m.release_date || "").slice(0, 4),
    description: m.overview,
    imdbRating: m.vote_average ? Number(m.vote_average).toFixed(1) : undefined,
  };
}

// ----- Catalog handler -----
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  try {
    if (type !== "movie") return { metas: [] };

    // Map catalog ID to date ranges
    const ranges = {
      nineties: { gte: "1990-01-01", lte: "1999-12-31" },
      two_thousands: { gte: "2000-01-01", lte: "2010-12-31" },
    };
    const range = ranges[id];
    if (!range) return { metas: [] };

    const limit = Math.min(Number(extra?.limit) || 50, 100);
    const skip = Number(extra?.skip) || 0;
    const page = Math.floor(skip / limit) + 1;

    const sortMap = {
      popularity: "popularity.desc",
      rating: "vote_average.desc",
      release: "primary_release_date.desc",
    };

    const genreId = extra?.genre ? mapGenreToId(extra.genre) : undefined;

    const params = {
      include_adult: false,
      language: "en-US",
      sort_by: sortMap[extra?.sort] || "popularity.desc",
      page,
      "primary_release_date.gte": range.gte,
      "primary_release_date.lte": range.lte,
      with_original_language: undefined,
    };
    if (genreId) params.with_genres = String(genreId);

    let json;
    if (extra?.search) {
      json = await tmdb("/search/movie", {
        query: extra.search,
        page,
        include_adult: false,
        language: "en-US",
      });
      json.results = (json.results || []).filter(m => {
        const y = Number((m.release_date || "").slice(0, 4));
        if (!y) return false;
        const minY = Number(range.gte.slice(0, 4));
        const maxY = Number(range.lte.slice(0, 4));
        return y >= minY && y <= maxY;
      });
    } else {
      json = await tmdb("/discover/movie", params);
    }

    const metas = (json.results || []).map(toMetaPreview);
    return { metas };
  } catch (err) {
    console.error("Catalog error:", err.message);
    return { metas: [] };
  }
});

// ----- Meta handler -----
builder.defineMetaHandler(async ({ id }) => {
  try {
    const tmdbId = id.startsWith("tmdb:") ? id.split(":")[1] : id;
    const movie = await tmdb(`/movie/${tmdbId}`, { language: "en-US" });
    const videos = await tmdb(`/movie/${tmdbId}/videos`, { language: "en-US" }).catch(() => ({ results: [] }));
    const trailer = (videos.results || []).find(v => v.type === "Trailer" && v.site === "YouTube");

    const meta = {
      id: `tmdb:${movie.id}`,
      type: "movie",
      name: movie.title,
      poster: IMG(movie.poster_path),
      background: IMG(movie.backdrop_path, "w780"),
      description: movie.overview,
      releaseInfo: (movie.release_date || "").slice(0, 4),
      imdbRating: movie.vote_average ? Number(movie.vote_average).toFixed(1) : undefined,
      runtime: movie.runtime ? `${movie.runtime} min` : undefined,
      genres: (movie.genres || []).map(g => g.name),
      trailers: trailer ? [{
        source: trailer.key,
        type: "Trailer",
        name: trailer.name,
        site: "YouTube"
      }] : undefined,
    };

    return { meta };
  } catch (err) {
    console.error("Meta error:", err.message);
    return { meta: { id, type: "movie", name: "Unavailable" } };
  }
});

// ----- Serve -----
const { serve } = serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log(`\nStremio add-on running → http://localhost:${process.env.PORT || 7000}/manifest.json`);

/*
=========================================
Quick start
=========================================
1) Save this as index.js
2) npm init -y
3) npm i stremio-addon-sdk node-fetch
4) export TMDB_API_KEY=your_key_here
5) node index.js
6) In Stremio: Add-ons → Community → "Install via URL" → http://YOUR_HOST:7000/manifest.json

Optional: .env
-----------------------------------------
TMDB_API_KEY=your_key
PORT=7000

package.json (example)
-----------------------------------------
{
  "name": "stremio-90s-2010s-catalog",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "license": "MIT",
  "scripts": {
    "start": "node index.js",
    "dev": "NODE_ENV=development node index.js"
  },
  "dependencies": {
    "node-fetch": "^3.3.2",
    "stremio-addon-sdk": "^1.6.9"
  }
}

Notes
-----------------------------------------
• This add-on is metadata-only (no streams). Pair it with streaming/resolver add-ons you already use.
• The catalog supports search, genre filter, sorting, and pagination via Stremio's `skip` and `limit`.
• You can hard-lock language or add region filters inside the `params` object in the catalog handler.
• Want to extend to 2015 or split by decade? Duplicate the catalog entry with different date ranges & IDs.
*/
