// /api/feedback.js
import fs from "fs";
import path from "path";

// --- CORS helper ---
function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const feedback = {
      timestamp: new Date().toISOString(),
      player: body.player || null,
      prop: body.prop || null,
      systemDecision: body.systemDecision || null,
      systemConfidence: body.systemConfidence || null,
      actualOutcome: body.actualOutcome || null, // e.g. "Hit" or "Missed"
      notes: body.notes || "",                   // optional user notes
    };

    // File lives at /data/feedback.json (make sure /data exists in repo root)
    const dataDir = path.join(process.cwd(), "data");
    const filePath = path.join(dataDir, "feedback.json");

    // Ensure folder exists
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    // Read existing
    let existing = [];
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        existing = JSON.parse(raw);
      } catch {
        existing = [];
      }
    }

    // Append new feedback
    existing.push(feedback);
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));

    console.log("[/api/feedback] Logged:", feedback);

    res.status(200).json({ ok: true, logged: feedback });
  } catch (err) {
    console.error("[/api/feedback] ERROR", err);
    res.status(500).json({ error: err.message });
  }
}
