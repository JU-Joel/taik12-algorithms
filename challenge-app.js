// Challenge site: hand-in forms, badges, sprints, live leaderboards and the
// "My nickname" page. Talks to the course's challenge API (a Cloudflare
// Worker); the API base comes from <meta name="challenge-api">.
// Nickname and personal key are kept in this browser only (localStorage);
// the page works without storage, the student then types them each time.
(function () {
  "use strict";
  const meta = document.querySelector('meta[name="challenge-api"]');
  if (!meta) return;
  const API = meta.content.replace(/\/$/, "");
  const STORE = "taik12.player";

  const load = () => {
    try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch (e) { return {}; }
  };
  const save = (p) => {
    try { localStorage.setItem(STORE, JSON.stringify(p)); } catch (e) { /* private mode: fine */ }
  };
  let player = load();

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  }

  async function api(path, body) {
    const opts = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {};
    const res = await fetch(API + path, opts);
    const data = await res.json().catch(() => ({ error: "the server did not answer" }));
    if (!res.ok) throw new Error(data.error || "request failed");
    return data;
  }

  // ------------------------------------------------------------- identity
  function identityFields() {
    const nick = el("input", { type: "text", placeholder: "nickname", "aria-label": "Nickname", maxlength: "20",
      autocomplete: "off", value: player.nickname || "" });
    const key = el("input", { type: "text", placeholder: "personal key (empty on your first hand-in)",
      "aria-label": "Personal key", autocomplete: "off", value: player.key || "" });
    const box = el("div", { class: "ch-id" }, nick, key);
    return { box, read: () => ({ nickname: nick.value.trim(), key: key.value.trim() }),
      set: (p) => { nick.value = p.nickname || ""; key.value = p.key || ""; } };
  }

  function remember(nickname, key) {
    player = { ...player, nickname };
    if (key) player.key = key;
    save(player);
    document.querySelectorAll(".ch-id input[aria-label=Nickname]").forEach((i) => { i.value = nickname; });
    if (key) document.querySelectorAll(".ch-id input[aria-label='Personal key']").forEach((i) => { i.value = key; });
  }

  function keyNotice(key) {
    return el("div", { class: "ch-key" },
      el("strong", { text: "Your personal key: " }), el("code", { text: key }),
      el("span", { text: " This browser remembers it. Save it too: you need it on another device." }));
  }

  // --------------------------------------------------------------- widgets
  function submitWidget(node) {
    const activity = node.dataset.activity;
    const kind = node.dataset.kind || "challenge";
    const id = identityFields();
    const area = kind === "challenge"
      ? el("textarea", { rows: "4", placeholder: "Paste your answer here (or load a file)", "aria-label": "Answer" })
      : el("input", { type: "text", placeholder: "your answer", "aria-label": "Answer", autocomplete: "off" });
    const file = kind === "challenge" ? el("input", { type: "file", accept: ".txt,text/plain", "aria-label": "Load answer from a file" }) : null;
    if (file) file.addEventListener("change", async () => { if (file.files[0]) area.value = await file.files[0].text(); });
    const out = el("div", { class: "ch-out", role: "status", "aria-live": "polite" });
    const button = el("button", { type: "submit", class: "ch-btn", text: kind === "badge" ? "Check" : "Submit" });
    const form = el("form", { class: `ch-form ch-${kind}` }, id.box, area, file, button, out);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      button.disabled = true;
      out.className = "ch-out";
      out.textContent = "Checking …";
      try {
        const who = id.read();
        const r = await api("/api/submit", { activity, ...who, answer: area.value });
        remember(r.nickname, r.key);
        out.className = "ch-out " + (r.valid && (kind !== "badge" || r.score >= 1) ? "ok" : "bad");
        out.textContent = r.message + (kind === "challenge" && r.valid ? ` · your best: ${r.best}` : "");
        if (r.key) out.append(keyNotice(r.key));
        refreshBoards();
      } catch (err) {
        out.className = "ch-out bad";
        out.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });
    node.replaceChildren(form);
  }

  function sprintWidget(node, catalog) {
    const id = node.dataset.activity;
    const session = catalog.sessions.find((s) => s.sprint && s.sprint.id === id);
    if (!session) return;
    const open = catalog.sprintOpen[id];
    if (!open) {
      node.replaceChildren(el("p", { class: "ch-closed", text: "The sprint opens here when your teacher starts it in the session." }));
      return;
    }
    const ident = identityFields();
    const inputs = session.sprint.parts.map((p, i) => el("label", { class: "ch-part" },
      el("span", { text: `${i + 1}. ${p.question}` }), el("input", { type: "text", "aria-label": `Answer ${i + 1}`, autocomplete: "off" })));
    const out = el("div", { class: "ch-out", role: "status", "aria-live": "polite" });
    const button = el("button", { type: "submit", class: "ch-btn", text: "Submit our answers" });
    const form = el("form", { class: "ch-form ch-sprint" },
      el("p", { class: "ch-hint", text: "One submission per team, under your team's nickname. Every correct part is a point; the clock breaks ties." }),
      ident.box, ...inputs, button, out);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      button.disabled = true;
      try {
        const parts = inputs.map((l) => l.querySelector("input").value);
        const r = await api("/api/submit", { activity: id, ...ident.read(), answer: parts.join("\n"), parts });
        remember(r.nickname, r.key);
        out.className = "ch-out ok";
        out.textContent = r.message;
        if (r.key) out.append(keyNotice(r.key));
        refreshBoards();
      } catch (err) {
        out.className = "ch-out bad";
        out.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });
    node.replaceChildren(form);
  }

  // ----------------------------------------------------------- leaderboards
  function table(head, rows) {
    return el("table", { class: "table ch-board" },
      el("thead", {}, el("tr", {}, ...head.map((h) => el("th", { text: h })))),
      el("tbody", {}, ...(rows.length ? rows.map((r) => el("tr", {}, ...r.map((c) => el("td", { text: String(c) }))))
        : [el("tr", {}, el("td", { colspan: String(head.length), text: "No entries yet: be the first." }))])));
  }

  let catalogCache = null;
  let boardNodes = [];
  async function refreshBoards() {
    if (!boardNodes.length) return;
    let data;
    try { data = await api("/api/boards"); } catch (err) { return; }
    const titles = {};
    for (const s of catalogCache.sessions) for (const c of s.challenges || []) titles[c.id] = { ...c, session: s.id };
    for (const node of boardNodes) {
      const only = node.dataset.activity;
      const parts = [];
      if (!only || only === "season") {
        parts.push(el("h3", { text: `Season ${data.season}: badges and Kattis` }),
          table(["Nickname", "Badges", "Kattis solved", "Challenges entered"],
            data.table.map((r) => [r.nickname, r.badges, r.kattis == null ? "–" : r.kattis, r.challenges])));
      }
      for (const [id, info] of Object.entries(titles)) {
        if (only && only !== "season" && only !== id) continue;
        if (only === "season") continue;
        const rows = (data.challenges[id] || []).map((r) => [r.rank, r.nickname, info.unit === "km" ? r.score.toFixed(3) : r.score]);
        parts.push(el("h3", { text: `${info.session} · ${info.title}` }), table(["Rank", "Nickname", `Score (${info.unit})`], rows));
      }
      if (!only) {
        for (const [id, rows] of Object.entries(data.sprints)) {
          parts.push(el("h3", { text: `Sprint ${id}` }), table(["Rank", "Team", "Parts correct"], rows.map((r) => [r.rank, r.nickname, r.score])));
        }
      }
      parts.push(el("p", { class: "ch-updated", text: `Live · updated ${new Date(data.updated).toLocaleTimeString()}` }));
      node.replaceChildren(...parts);
    }
  }

  // ------------------------------------------------------------- My nickname
  function mePage(node) {
    const ident = identityFields();
    const out = el("div", { class: "ch-out", role: "status", "aria-live": "polite" });
    const results = el("div");
    const kattis = el("input", { type: "text", placeholder: "your name on the Kattis standings", "aria-label": "Kattis name" });
    const show = el("button", { type: "button", class: "ch-btn", text: "Show my results" });
    const link = el("button", { type: "button", class: "ch-btn", text: "Save Kattis name" });
    const forget = el("button", { type: "button", class: "ch-btn ch-quiet", text: "Forget me on this device" });
    show.addEventListener("click", async () => {
      try {
        const who = ident.read();
        const r = await api(`/api/me?nickname=${encodeURIComponent(who.nickname)}&key=${encodeURIComponent(who.key)}`);
        remember(r.nickname, who.key);
        kattis.value = r.kattis_name || "";
        const badges = r.results.filter((x) => x.kind === "badge" && x.score >= 1).map((x) => x.activity);
        results.replaceChildren(table(["Activity", "Kind", "Best", "Attempts"], r.results.map((x) => [x.activity, x.kind, x.score, x.attempts])),
          el("p", { text: `Badges: ${badges.length}` }));
        out.className = "ch-out ok";
        out.textContent = `Signed in as ${r.nickname} on this device.`;
      } catch (err) {
        out.className = "ch-out bad";
        out.textContent = err.message;
      }
    });
    link.addEventListener("click", async () => {
      try {
        const r = await api("/api/kattis", { ...ident.read(), kattis_name: kattis.value });
        out.className = "ch-out ok";
        out.textContent = `Saved: your Kattis name is ${r.kattis_name}. Solves appear after the next daily update.`;
      } catch (err) {
        out.className = "ch-out bad";
        out.textContent = err.message;
      }
    });
    forget.addEventListener("click", () => {
      player = {};
      save(player);
      ident.set({});
      results.replaceChildren();
      out.className = "ch-out";
      out.textContent = "Forgotten on this device. Your results stay on the leaderboard.";
    });
    node.replaceChildren(el("div", { class: "ch-form" }, ident.box, show, forget,
      el("h3", { text: "Kattis" }),
      el("p", { text: "Join the session's Kattis contest, then give the name that the contest standings show for you." }),
      kattis, link, out), results);
  }

  async function start() {
    document.querySelectorAll(".ch-submit-slot").forEach(submitWidget);
    document.querySelectorAll(".ch-me-slot").forEach(mePage);
    const needsCatalog = document.querySelector(".ch-boards, .ch-sprint-slot, .ch-kattis-link");
    if (needsCatalog) {
      try { catalogCache = await api("/api/catalog"); } catch (err) {
        document.querySelectorAll(".ch-boards, .ch-sprint-slot").forEach((n) => n.replaceChildren(
          el("p", { class: "ch-closed", text: "The challenge server cannot be reached right now. Try again in a minute." })));
        return;
      }
    }
    document.querySelectorAll(".ch-sprint-slot").forEach((n) => sprintWidget(n, catalogCache));
    document.querySelectorAll(".ch-kattis-link").forEach((n) => {
      const contest = catalogCache.kattisContests[n.dataset.session];
      n.replaceChildren(contest
        ? el("a", { href: `https://open.kattis.com/contests/${contest}`, text: "Open the session's Kattis contest", class: "ch-btn" })
        : el("span", { class: "ch-closed", text: "The contest link appears here when the session starts." }));
    });
    boardNodes = [...document.querySelectorAll(".ch-boards")];
    if (boardNodes.length) {
      await refreshBoards();
      setInterval(() => { if (!document.hidden) refreshBoards(); }, 60000);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshBoards(); });
    }
    // A sprint slot re-checks every 20 s whether the teacher has opened it.
    const sprints = [...document.querySelectorAll(".ch-sprint-slot")];
    if (sprints.length) {
      setInterval(async () => {
        try {
          const fresh = await api("/api/catalog");
          for (const n of sprints) if (fresh.sprintOpen[n.dataset.activity] !== catalogCache.sprintOpen[n.dataset.activity] && !n.querySelector("form input:focus")) sprintWidget(n, fresh);
          catalogCache = fresh;
        } catch (err) { /* keep the last state */ }
      }, 30000);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
