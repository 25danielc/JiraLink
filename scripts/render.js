// scripts/render.js — the renderer (I/O shell).
//
// Reads published.json and rebuilds the entire feed file from it. Full
// re-render (not append) means the output is always a pure function of state:
// deterministic, no drift, no duplicate-bullet bugs. String-building lives in
// lib/render-md.js so it can be unit-tested offline.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { config } from "../config.js";
import { renderFeed } from "../lib/render-md.js";

const state = existsSync(config.stateFile)
  ? JSON.parse(readFileSync(config.stateFile, "utf8"))
  : { entries: {} };
const entries = Object.values(state.entries || {});

mkdirSync(config.outDir, { recursive: true });
writeFileSync(config.feedFile, renderFeed(entries));

console.log(`Rendered ${entries.length} entr${entries.length === 1 ? "y" : "ies"} -> ${config.feedFile}`);
