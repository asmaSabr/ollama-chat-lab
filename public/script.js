// ---------- Authentification ----------
const API_TOKEN = prompt("Token d'accès :") ?? "";
const AUTH = { Authorization: `Bearer ${API_TOKEN}` };

// ---------- Éléments du DOM ----------
const messagesEl  = document.getElementById("messages");
const form        = document.getElementById("chat-form");
const input       = document.getElementById("input");
const sendBtn     = document.getElementById("send");
const stopBtn     = document.getElementById("stop");
const newChatBtn  = document.getElementById("new-chat");
const modelSelect = document.getElementById("model");
const thinkWrap   = document.getElementById("think-wrap");
const thinkBox    = document.getElementById("think");
const statsEl     = document.getElementById("stats");

// ---------- État ----------
let history = [];        // toute la conversation (Ollama est stateless)
let models = [];         // [{ name, capabilities }]
let controller = null;   // AbortController de la requête en cours

// ---------- Lecture NDJSON ----------
// Un chunk réseau ≠ une ligne JSON : il peut contenir plusieurs lignes ou une demi-ligne.
async function* readNDJSON(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();               // dernier morceau : peut-être incomplet → on le garde

    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line);
    }
  }

  buffer += decoder.decode();           // vide le décodeur
  if (buffer.trim()) yield JSON.parse(buffer);
}

// ---------- Rendu Markdown sécurisé ----------
// La sortie du modèle est non fiable : marked → HTML, puis DOMPurify retire tout code dangereux.
function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text));
}

// ---------- Modèles ----------
async function loadModels() {
  try {
    const r = await fetch("/api/models", { headers: AUTH });
    if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
    models = await r.json();

    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.name;
      opt.textContent = m.name;
      modelSelect.append(opt);
    }
    updateThinkToggle();
  } catch (err) {
    showError("Impossible de charger les modèles : " + err.message);
  }
}

function updateThinkToggle() {
  const m = models.find((x) => x.name === modelSelect.value);
  thinkWrap.hidden = !m?.capabilities.includes("thinking");
}

modelSelect.addEventListener("change", updateThinkToggle);

// ---------- Affichage ----------
function scrollDown() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addUserBubble(text) {
  const div = document.createElement("div");
  div.className = "msg user";
  div.textContent = text;              // message utilisateur : texte brut
  messagesEl.append(div);
  scrollDown();
}

function addAssistantBubble() {
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";

  const details = document.createElement("details");
  details.className = "thinking";
  details.hidden = true;
  const summary = document.createElement("summary");
  summary.textContent = "Raisonnement";
  const thinkingText = document.createElement("div");
  details.append(summary, thinkingText);

  const content = document.createElement("div");
  content.className = "content";
  wrap.append(details, content);
  messagesEl.append(wrap);
  scrollDown();

  return { wrap, details, thinkingText, content };
}

function showError(message) {
  const div = document.createElement("div");
  div.className = "msg error";
  div.textContent = "⚠ " + message;
  messagesEl.append(div);
  scrollDown();
}

function showStats(chunk) {
  if (!chunk.eval_count || !chunk.eval_duration) return;
  const tps = chunk.eval_count / (chunk.eval_duration / 1e9);   // ns → s
  statsEl.textContent = `${chunk.eval_count} tokens · ${tps.toFixed(1)} tokens/s`;
}

function setBusy(busy) {
  input.disabled = busy;
  sendBtn.disabled = busy;
  modelSelect.disabled = busy;
  thinkBox.disabled = busy;
  newChatBtn.disabled = busy;
  stopBtn.hidden = !busy;
}

// ---------- Envoi d'un message ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || controller) return;

  input.value = "";
  history.push({ role: "user", content: text });
  addUserBubble(text);

  const ui = addAssistantBubble();
  statsEl.textContent = "";
  controller = new AbortController();
  setBusy(true);

  let answer = "";
  let thinking = "";

  const body = { model: modelSelect.value, messages: history };
  if (!thinkWrap.hidden) body.think = thinkBox.checked;

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error ?? `HTTP ${r.status}`);
    }

    for await (const chunk of readNDJSON(r)) {
      if (chunk.error) throw new Error(chunk.error);   // erreur en plein stream

      if (chunk.message?.thinking) {
        thinking += chunk.message.thinking;
        ui.details.hidden = false;
        ui.thinkingText.textContent = thinking;       // raisonnement : texte brut
      }
      if (chunk.message?.content) {
        answer += chunk.message.content;
        ui.content.innerHTML = renderMarkdown(answer); // réponse : Markdown assaini
      }
      if (chunk.done) showStats(chunk);
      scrollDown();
    }

    history.push({ role: "assistant", content: answer });

  } catch (err) {
    if (err.name === "AbortError") {
      // Stop : pas une erreur → on garde la réponse partielle
      if (answer) {
        history.push({ role: "assistant", content: answer });
        const note = document.createElement("div");
        note.className = "stopped";
        note.textContent = "(arrêté)";
        ui.wrap.append(note);
      } else {
        history.pop();               // rien reçu : on retire la question
        ui.wrap.remove();
      }
    } else {
      history.pop();                 // retire le message utilisateur sans réponse
      ui.wrap.remove();
      showError(err.message);
    }
  } finally {
    controller = null;
    setBusy(false);
    input.focus();
  }
});

// ---------- Stop & New chat ----------
stopBtn.addEventListener("click", () => controller?.abort());

newChatBtn.addEventListener("click", () => {
  history = [];
  messagesEl.replaceChildren();
  statsEl.textContent = "";
  input.focus();
});

loadModels();