// /api/feedback.js
import fs from "fs";
import path from "path";

// --- CORS helper ---
function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;

    const entry = {
      player: body.player || null,
      prop: body.prop || null,
      decision: body.decision || null,
      confidence: body.confidence || null,
      suggestion: body.suggestion || null,
      hit: body.hit ?? null,
      notes: body.notes || "",
      timestamp: body.timestamp || new Date().toISOString(),
    };

    const dataDir = path.join(process.cwd(), "data");
    const filePath = path.join(dataDir, "feedback.json");

    // Ensure /data dir exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir);
    }

    let existing = [];
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        existing = JSON.parse(raw);
        if (!Array.isArray(existing)) existing = [];
      } catch {
        existing = [];
      }
    }

    existing.push(entry);

    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));

    console.log("[/api/feedback] Saved feedback", entry);

    res.status(200).json({ ok: true, saved: entry });
  } catch (err) {
    console.error("[/api/feedback] ERROR", err);
    res.status(500).json({ error: err.message });
  }
}
