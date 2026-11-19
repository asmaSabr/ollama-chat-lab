import express from "express";
import rateLimit from "express-rate-limit";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const app = express();
const PORT = 3000;
const OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";
const API_TOKEN = process.env.API_TOKEN ?? "change-me";
const MAX_MESSAGES = 50;
const JSON_HEADERS = { "Content-Type": "application/json" };

// ---------- Middlewares ----------
app.use(express.json({ limit: "100kb" }));   // body trop gros → 413
app.use(express.static("public"));           // page accessible sans token

// Rate limit : 20 requêtes / minute / IP sur /api
app.use("/api", rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, try again in a minute" },
}));

// Authentification simple par token (header Authorization: Bearer <token>)
app.use("/api", (req, res, next) => {
  if (req.headers.authorization !== `Bearer ${API_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// ---------- POST /api/chat ----------
app.post("/api/chat", async (req, res) => {
  const { messages, model = DEFAULT_MODEL, stream = true, think } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array" });
  }
  if (messages.length > MAX_MESSAGES) {
    return res.status(413).json({ error: `Conversation too long (max ${MAX_MESSAGES} messages)` });
  }

  // Annuler la requête vers Ollama si le client se déconnecte
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const payload = { model, messages, stream };
  if (think !== undefined) payload.think = think; // transmis tel quel

  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!r.ok) {
      const text = await r.text();
      let message = text;
      try {
        message = JSON.parse(text).error ?? text;
      } catch {}
      return res.status(r.status).json({ error: message });
    }

    if (!stream) {
      return res.json(await r.json());
    }

    res.setHeader("Content-Type", "application/x-ndjson");
    await pipeline(Readable.fromWeb(r.body), res);
  } catch (err) {
    // Le client est parti : rien à envoyer, ce n'est pas une erreur
    if (controller.signal.aborted) return;

    console.error(err);
    if (!res.headersSent) {
      res.status(502).json({ error: "Cannot reach Ollama" });
    } else {
      res.end(); // headers déjà envoyés : impossible d'envoyer un JSON d'erreur
    }
  }
});

// ---------- GET /api/models ----------
app.get("/api/models", async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!r.ok) {
      return res.status(r.status).json({ error: "Cannot list models" });
    }
    const { models } = await r.json();

    const result = await Promise.all(
      models.map(async (m) => {
        const s = await fetch(`${OLLAMA_URL}/api/show`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ model: m.name }),
        });
        const info = s.ok ? await s.json() : {};
        return { name: m.name, capabilities: info.capabilities ?? [] };
      })
    );

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Cannot reach Ollama" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} (model: ${DEFAULT_MODEL})`);
});