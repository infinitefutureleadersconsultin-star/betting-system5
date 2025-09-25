// api/feedback.js
// Minimal feedback logger for "Didn't Hit" button.
// Appends JSON entries to data/feedback.json (array). Best-effort; works in dev and in environments with writable FS.

import fs from "fs";
import path from "path";

const FB_PATH = path.join(process.cwd(), "data", "feedback.json");

function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return true; }
  return false;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" }); return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch (err) {
    res.status(400).json({ error: "Invalid JSON" }); return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    note: body.note || "",
    resultSnapshot: body.result || null,
    actualOutcome: body.actualOutcome || null,
    meta: body.meta || {}
  };

  try {
    let arr = [];
    try {
      if (fs.existsSync(FB_PATH)) {
        const raw = fs.readFileSync(FB_PATH, "utf8");
        arr = JSON.parse(raw) || [];
      } else {
        // ensure directory
        const dir = path.dirname(FB_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      }
    } catch (e) {
      // ignore parse errors
      arr = [];
    }
    arr.push(entry);
    try {
      fs.writeFileSync(FB_PATH, JSON.stringify(arr, null, 2), "utf8");
    } catch (e) {
      // If no disk, still succeed — maybe on Vercel serverless where write isn't allowed.
    }
    res.status(200).json({ ok: true, entry });
  } catch (err) {
    console.error("[/api/feedback] error", err);
    res.status(500).json({ error: err.message || "write failed" });
  }
}
