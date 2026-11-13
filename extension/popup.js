/**
 * popup.js — JobFlow v3
 *
 * Title field is now a plain text input with live autocomplete against
 * the AF list. The AI writes its best-guess title as text; the user
 * can type to filter and pick, exactly like the AF form itself.
 */

const SERVER_URL = "http://localhost:4000/api/jobs";
const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";

let AF_TITLES       = [];   // full canonical list
let confirmedTitle  = "";   // tracks the last value the user confirmed from the list
let activeIndex     = -1;   // keyboard nav index in dropdown

// ─── UI helpers ──────────────────────────────────────────────────────────────

function setStatus(msg, type = "") {
  const el = document.getElementById("ai-status");
  el.className = type === "hidden" ? "hidden" : (type || "");
  el.innerHTML = type === "loading"
    ? `<span class="spinner"></span> ${msg}`
    : msg;
}

function setSaveStatus(msg, cls = "") {
  const el = document.getElementById("save-status");
  el.textContent = msg;
  el.className = cls;
}

function setTitleHint(msg, cls = "") {
  const el = document.getElementById("title-hint");
  el.textContent = msg;
  el.className = "field-hint " + cls;
}

// ─── API key ─────────────────────────────────────────────────────────────────

function getApiKey() {
  return new Promise(r => chrome.storage.local.get("groqApiKey", d => r(d.groqApiKey || "")));
}
function saveApiKey(key) {
  return new Promise(r => chrome.storage.local.set({ groqApiKey: key }, r));
}

// ─── Title autocomplete ───────────────────────────────────────────────────────

async function loadTitles() {
  const res = await fetch(chrome.runtime.getURL("titles.json"));
  AF_TITLES = await res.json();
}

// Filter titles: split query into words, every word must appear in the title
function filterTitles(query) {
  if (!query.trim()) return [];
  const words = query.toLowerCase().split(/\s+/);
  return AF_TITLES.filter(t =>
    words.every(w => t.toLowerCase().includes(w))
  ).slice(0, 12); // cap at 12 suggestions
}

function showSuggestions(matches) {
  const box = document.getElementById("title-suggestions");
  activeIndex = -1;

  if (!matches.length) {
    box.style.display = "none";
    return;
  }

  box.innerHTML = "";
  for (const m of matches) {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = m;
    div.addEventListener("mousedown", e => {
      e.preventDefault(); // don't blur the input first
      pickTitle(m);
    });
    box.appendChild(div);
  }
  box.style.display = "block";
}

function hideSuggestions() {
  document.getElementById("title-suggestions").style.display = "none";
  activeIndex = -1;
}

function pickTitle(value) {
  const input = document.getElementById("title");
  input.value = value;
  confirmedTitle = value;
  hideSuggestions();
  input.classList.remove("invalid");
  input.classList.add("valid");
  setTitleHint("✓ Matches an Arbetsförmedlingen title.", "ok");
}

// Set title from AI (or manually) — validates against list
function setTitle(value) {
  const input = document.getElementById("title");

  // Exact match?
  if (AF_TITLES.includes(value)) {
    pickTitle(value);
    return;
  }

  // Partial: write it anyway and show dropdown so user can correct
  input.value = value;
  confirmedTitle = "";
  input.classList.add("invalid");
  setTitleHint(`"${value}" not found — pick one from the list below.`, "bad");
  showSuggestions(filterTitles(value));
}

// ─── Page scraping ────────────────────────────────────────────────────────────

async function getPageText(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const el = document.body.cloneNode(true);
      for (const tag of el.querySelectorAll("script,style,nav,header,footer,noscript,aside"))
        tag.remove();
      return (el.innerText || el.textContent || "")
        .replace(/\s+/g, " ").trim().slice(0, 5000);
    }
  });
  return results?.[0]?.result || "";
}

// ─── Groq call ───────────────────────────────────────────────────────────────

async function extractWithGroq(pageText, apiKey) {
  const titlesBlock = AF_TITLES.join("\n");

  const system = `You are a job listing parser.

Given job posting text, extract:
1. The job title — pick the SINGLE closest match from this exact list (copy it character-for-character):
${titlesBlock}

2. Company name.
3. City (Swedish city, or empty string if remote/unknown).
4. Employment type: exactly one of Heltid, Deltid, Vikariat, Sommarjobb.

Respond with ONLY a raw JSON object — no markdown, no explanation:
{"title":"...","company":"...","city":"...","employment":"..."}

Rules:
- "title" MUST be copied verbatim from the list above.
- If nothing matches well, use "Mjukvaruutvecklare" as fallback.
- "employment" defaults to "Heltid" when not stated.`;

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      max_tokens: 120,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: `Page text:\n\n${pageText}` }
      ]
    })
  });

  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);

  const data  = await res.json();
  const raw   = data.choices?.[0]?.message?.content || "{}";
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─── Main extraction ──────────────────────────────────────────────────────────

async function extractAndFill(tab) {
  setStatus("Reading page…", "loading");

  const apiKey = await getApiKey();
  if (!apiKey) {
    setStatus("⚠️ Enter your Groq API key and click <strong>Save key</strong> first.", "error");
    return;
  }

  let pageText;
  try {
    pageText = await getPageText(tab.id);
  } catch {
    setStatus("⚠️ Couldn't read page — try refreshing the tab.", "error");
    return;
  }

  if (!pageText) {
    setStatus("⚠️ Page appears empty or is blocking scripts.", "error");
    return;
  }

  setStatus("AI extracting…", "loading");

  let extracted;
  try {
    extracted = await extractWithGroq(pageText, apiKey);
  } catch (e) {
    setStatus(`⚠️ ${e.message}`, "error");
    return;
  }

  // Populate fields
  setTitle(extracted.title || "");
  if (extracted.company)    document.getElementById("company").value = extracted.company;
  if (extracted.city)       document.getElementById("city").value    = extracted.city;
  if (extracted.employment) {
    const sel = document.getElementById("employment");
    for (const opt of sel.options)
      if (opt.value === extracted.employment) { opt.selected = true; break; }
  }

  const titleOk = AF_TITLES.includes(extracted.title);
  if (titleOk) {
    setStatus(`✅ <strong>${extracted.title}</strong> at ${extracted.company || "?"}. Looks good? Hit Save.`, "success");
  } else {
    setStatus(`⚠️ AI returned "${extracted.title}" — not in the list. Pick the right one from the dropdown.`, "error");
  }
}

// ─── Save to local server ─────────────────────────────────────────────────────

async function saveJob() {
  const titleInput = document.getElementById("title").value.trim();

  // Must be an exact AF title
  if (!AF_TITLES.includes(titleInput)) {
    setTitleHint("Pick a title from the list before saving.", "bad");
    document.getElementById("title").classList.add("invalid");
    return;
  }

  const btn = document.getElementById("save");
  const job = {
    title:       titleInput,
    company:     document.getElementById("company").value.trim(),
    city:        document.getElementById("city").value.trim(),
    employment:  document.getElementById("employment").value,
    url:         document.getElementById("url").value,
    appliedDate: new Date().toISOString().slice(0, 10)
  };

  if (!job.company) { setSaveStatus("Please fill in the company name.", "err"); return; }

  btn.disabled = true;
  setSaveStatus("Saving…");

  try {
    const res = await fetch(SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job)
    });
    if (!res.ok) throw new Error(await res.text());
    setSaveStatus("✅ Saved!", "ok");
  } catch {
    setSaveStatus("⚠️ Server not reachable — run: cd server && npm start", "err");
  } finally {
    btn.disabled = false;
  }
}

// ─── Keyboard navigation in dropdown ─────────────────────────────────────────

function handleTitleKeydown(e) {
  const box   = document.getElementById("title-suggestions");
  const items = box.querySelectorAll(".item");
  if (!items.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, items.length - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
  } else if (e.key === "Enter" && activeIndex >= 0) {
    e.preventDefault();
    pickTitle(items[activeIndex].textContent);
    return;
  } else if (e.key === "Escape") {
    hideSuggestions();
    return;
  } else {
    return;
  }

  items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await loadTitles();

  const saved = await getApiKey();
  if (saved) document.getElementById("api-key").placeholder = "Key saved ✓ — paste to update";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    document.getElementById("url").value = tab.url || "";
    extractAndFill(tab);
  }

  // Title input — live autocomplete
  const titleInput = document.getElementById("title");

  titleInput.addEventListener("input", () => {
    const q = titleInput.value;
    confirmedTitle = "";
    titleInput.classList.remove("valid");

    if (!q.trim()) {
      hideSuggestions();
      setTitleHint("Must match an exact Arbetsförmedlingen title.");
      return;
    }

    const matches = filterTitles(q);
    // If the typed value IS an exact AF title already, mark it valid immediately
    if (AF_TITLES.includes(q)) {
      confirmedTitle = q;
      titleInput.classList.remove("invalid");
      titleInput.classList.add("valid");
      setTitleHint("✓ Matches an Arbetsförmedlingen title.", "ok");
      hideSuggestions();
    } else {
      titleInput.classList.add("invalid");
      setTitleHint("Type to search — then click or press ↓ Enter to confirm.", "");
      showSuggestions(matches);
    }
  });

  titleInput.addEventListener("keydown", handleTitleKeydown);
  titleInput.addEventListener("blur", () => setTimeout(hideSuggestions, 150));

  // API key
  document.getElementById("save-key").addEventListener("click", async () => {
    const key = document.getElementById("api-key").value.trim();
    if (!key) return;
    await saveApiKey(key);
    document.getElementById("api-key").value = "";
    document.getElementById("api-key").placeholder = "Key saved ✓ — paste to update";
    setSaveStatus("API key saved.", "ok");
    if (tab) extractAndFill(tab);
  });

  document.getElementById("retry").addEventListener("click", () => { if (tab) extractAndFill(tab); });
  document.getElementById("save").addEventListener("click", saveJob);
});
