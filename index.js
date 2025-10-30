// index.js — Stremio add-on: "80s–2010 (By Decade)"
// Catalog-only (no streams). Uses TMDb (v3) for metadata.

import fetch from "node-fetch";
import sdk from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = sdk;

const TMDB_API_KEY = process.env.TMDB_API_KEY;
if (!TMDB_API_KEY) {
  console.warn("[WARN] TMDB_API_KEY is not set. Add it to your env before starting.");
}

// ---------- Manifest ----------
const manifest = {
  id: "org.josh.classics_90s_2010s",
  version: "1.3.0",
  name: "90s–2010 (By Decade)",
  description:
    "Curated catalogs split by decade: 1990s and 2000s–2010. Metadata only; pair with your favorite streaming add-ons.",
  types: ["movie"],
  resources: ["catalog", "meta"],
  catalogs: [
    { type: "movie", id: "eighties",       name: "1980s Movies" },
    { type: "movie", id: "nineties",       name: "1990s Movies" },  
    { type: "movie", id: "two_thousands",  name: "2000s–2010 Movies" }
  ],
};

const builder = new addonBuilder(manifest);

// ---------- Helpers ----------
const TMDB_BASE = "https://api.themoviedb.org/3";
const img = (path, size = "w500") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;

const toMetaPreview = (m) => ({
  id: `tmdb:${m.id}`,
  type: "movie",
  name: m.title,
  poster: img(m.poster_path),
  background: img(m.backdrop_path, "w780"),
  releaseInfo: (m.release_date || "").slice(0, 4),
  description: m.overview,
  imdbRating: m.vote_average ? Number(m.vote_average).toFixed(1) : undefined,
});

async function tmdb(path, params = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", TMDB_API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`TMDb ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------- Catalog handler ----------
builder.defineCatalogHandler(async ({ id }) => {
  const ranges = {
    eighties:      { gte: "1980-01-01", lte: "1989-12-31" },
    nineties:      { gte: "1990-01-01", lte: "1999-12-31" },
    two_thousands: { gte: "2000-01-01", lte: "2010-12-31" },
    
  };
  const range = ranges[id];
  if (!range) return { metas: [] };

  const metas = [];
  const totalPages = 10; // up to 10 pages × 20 = ~200 titles/decade

  for (let page = 1; page <= totalPages; page++) {
    const data = await tmdb("/discover/movie", {
      language: "en-US",
      include_adult: false,
      // Sort by TMDb rating first; we'll globally sort again after merging pages.
      sort_by: "vote_average.desc",
      page,
      "primary_release_date.gte": range.gte,
      "primary_release_date.lte": range.lte,
      "vote_count.gte": 500, // avoid tiny-vote outliers
    });
    if (!data.results || !data.results.length) break;
    metas.push(...data.results.map(toMetaPreview));
  }

  // Global sort across all pages by rating (highest → lowest)
  metas.sort((a, b) => (parseFloat(b.imdbRating || 0) - parseFloat(a.imdbRating || 0)));

  return { metas };
});

// ---------- Meta handler ----------
builder.defineMetaHandler(async ({ id }) => {
  try {
    const tmdbId = id.startsWith("tmdb:") ? id.split(":")[1] : id;
    const movie  = await tmdb(`/movie/${tmdbId}`,  { language: "en-US" });
    const videos = await tmdb(`/movie/${tmdbId}/videos`, { language: "en-US" })
                      .catch(() => ({ results: [] }));
    const trailer = (videos.results || []).find(
      v => v.type === "Trailer" && v.site === "YouTube"
    );

    return {
      meta: {
        id: `tmdb:${movie.id}`,
        type: "movie",
        name: movie.title,
        poster: img(movie.poster_path),
        background: img(movie.backdrop_path, "w780"),
        description: movie.overview,
        releaseInfo: (movie.release_date || "").slice(0, 4),
        imdbRating: movie.vote_average ? Number(movie.vote_average).toFixed(1) : undefined,
        runtime: movie.runtime ? `${movie.runtime} min` : undefined,
        genres: (movie.genres || []).map(g => g.name),
        trailers: trailer
          ? [{ source: trailer.key, type: "Trailer", name: trailer.name, site: "YouTube" }]
          : undefined,
      },
    };
  } catch (err) {
    console.error("Meta error:", err.message);
    return { meta: { id, type: "movie", name: "Unavailable" } };
  }
});

// ---------- Serve ----------
serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log(`Stremio add-on running → http://localhost:${process.env.PORT || 7000}/manifest.json`);

