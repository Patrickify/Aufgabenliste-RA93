import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  initializeFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================================================
   AUFGABENLISTE ZDL RA 93 — FINAL STABLE
   - Admin/Superadmin ist an nameKey gebunden (nicht UID/Device)
   - iOS/Safari stabil: LongPolling + Snapshot-Fallback
   ========================================================= */

/* ---------------- Firebase config ---------------- */
const firebaseConfig = {
  apiKey: "AIzaSyCPTt1ZZ-lj5qZ1Rrn-N7e5QZnhtXB-Pu8",
  authDomain: "aufgabenliste-zdl-ra-93.firebaseapp.com",
  projectId: "aufgabenliste-zdl-ra-93",
  storageBucket: "aufgabenliste-zdl-ra-93.firebasestorage.app",
  messagingSenderId: "857214150388",
  appId: "1:857214150388:web:8bc019911092be0cffe0a1",
  measurementId: "G-6MC0G2V2YY"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

/* iOS/Safari stabile Firestore-Connection */
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false
});

/* ---------------- constants / refs ---------------- */
const MAX_SUPER = 3;
const MAX_ADMIN = 8;

const META_COUNTS_REF = doc(db, "meta", "admin_counts");
const META_DAY_REF = doc(db, "meta", "day_state");

/* ---------------- helpers ---------------- */
const $ = (id) => document.getElementById(id);
const show = (el, on) => { if (el) el.classList.toggle("hidden", !on); };
const n = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

function pad2(x) { return String(x).padStart(2, "0"); }
function dayKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}
function weekdayNow() { // 1=Mo ... 7=So
  const js = new Date().getDay(); // 0=So, 1=Mo...
  return js === 0 ? 7 : js;
}
function msUntilMidnight() {
  const d = new Date();
  const next = new Date(d);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - d.getTime();
}
function stamp() {
  const d = new Date();
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function keyOfName(name) {
  // stabil, “slug”
  return n(name).toLowerCase()
    .replace(/["'„“”]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9äöüß\-]/g, "");
}
function uniq(arr) {
  return Array.from(new Set((arr || []).map(x => n(x)).filter(Boolean)));
}

/* --- Password hashing (SHA-256) --- */
async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2, "0")).join("");
}
async function passHashFor(name, pass) {
  // Pepper = nameKey (stabil)
  return sha256Hex(`${keyOfName(name)}:${pass}`);
}

/* =========================================================
   ULTRA LISTENER (Snapshot -> Poll Fallback)
   ========================================================= */
const ULTRA_POLL_MS = 4000;

function ultraDocsToSnapLike_(docs) {
  return docs.map(d => ({ id: d.id, data: () => d.data() }));
}
function ultraListen_(q, onData) {
  let unsub = null;
  let pollId = null;

  async function pollOnce() {
    try {
      const snap = await getDocs(q);
      onData(ultraDocsToSnapLike_(snap.docs));
    } catch (e) {
      console.log("ULTRA poll error:", e?.message || e);
    }
  }
  function startPolling() {
    if (pollId) return;
    pollOnce();
    pollId = setInterval(pollOnce, ULTRA_POLL_MS);
    console.log("ULTRA MODE: polling enabled");
  }

  try {
    unsub = onSnapshot(
      q,
      (snap) => onData(ultraDocsToSnapLike_(snap.docs)),
      (err) => {
        console.log("ULTRA snapshot error:", err?.message || err);
        try { if (unsub) unsub(); } catch { }
        unsub = null;
        startPolling();
      }
    );
  } catch (e) {
    console.log("ULTRA snapshot init failed:", e?.message || e);
    startPolling();
  }

  return function unsubscribe() {
    try { if (unsub) unsub(); } catch { }
    unsub = null;
    if (pollId) { clearInterval(pollId); pollId = null; }
  };
}

/* ---------------- DOM ---------------- */
const loginView = $("loginView");
const appView = $("appView");

const whoami = $("whoami");
const reloadBtn = $("reloadBtn");
const logoutBtn = $("logoutBtn");

const nameSel = $("nameSel");
const passInp = $("passInp");
const loginBtn = $("loginBtn");
const loginErr = $("loginErr");

const tabBtns = Array.from(document.querySelectorAll(".tabbtn"));
const adminTabBtn = $("adminTabBtn");

const tagSearch = $("tagSearch");
const tagList = $("tagList");
const openTagTitle = $("openTagTitle");
const tagMeta = $("tagMeta");
const closeTagBtn = $("closeTagBtn");
const newDailyTaskBtn = $("newDailyTaskBtn");
const doneBySel = $("doneBySel");
const markSelectedDoneBtn = $("markSelectedDoneBtn");
const taskHint = $("taskHint");
const taskList = $("taskList");

const dayKeyBadge = $("dayKeyBadge");
const rideNameSel = $("rideNameSel");
const rideEinsatz = $("rideEinsatz");
const addRideBtn = $("addRideBtn");
const rideInfo = $("rideInfo");
const ridesList = $("ridesList");

const adminBadge = $("adminBadge");
const adminLock = $("adminLock");
const adminArea = $("adminArea");
const subtabBtns = Array.from(document.querySelectorAll(".subtabbtn"));

const empAdd = $("empAdd");
const empAddBtn = $("empAddBtn");
const empList = $("empList");

const tagAdd = $("tagAdd");
const tagAddBtn = $("tagAddBtn");
const adminTagList = $("adminTagList");

const planWeekdaySel = $("planWeekdaySel");
const planTagSel = $("planTagSel");
const planTaskInp = $("planTaskInp");
const planAddBtn = $("planAddBtn");
const planList = $("planList");

const forceDayChangeBtn = $("forceDayChangeBtn");
const regenTodayBtn = $("regenTodayBtn");
const finalList = $("finalList");

const adminUidAdd = $("adminUidAdd");
const adminUidAddBtn = $("adminUidAddBtn");
const adminUidList = $("adminUidList");

const superUidAdd = $("superUidAdd");
const superUidAddBtn = $("superUidAddBtn");
const superUidList = $("superUidList");

const vacFrom = $("vacFrom");
const vacUntil = $("vacUntil");
const vacSaveBtn = $("vacSaveBtn");
const vacClearBtn = $("vacClearBtn");
const vacInfo = $("vacInfo");

const pointsList = $("pointsList");

/* ---------------- state ---------------- */
let meName = "";
let meKey = "";
let isAdmin = false;
let isSuperAdmin = false;

let employees = [];
let tags = [];

let currentTagId = "";
let currentTagKey = "";
let selectedTaskId = "";

let myVacation = { from: "", until: "" };

let unsubEmployees = null, unsubTags = null, unsubTasks = null, unsubRides = null;
let unsubAdmins = null, unsubSupers = null, unsubWeekly = null, unsubFinal = null;

/* ---------------- auth helpers ---------------- */
async function ensureAnon_() {
  if (auth.currentUser) return;
  await signInAnonymously(auth);
}
async function alertSafe_(msg) { try { alert(msg); } catch { } }

/* ---------------- UI tabs ---------------- */
function setTab(tabId) {
  document.querySelectorAll(".tab").forEach(t => t.classList.add("hidden"));
  const el = $(tabId);
  el && el.classList.remove("hidden");
  tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
}
tabBtns.forEach(btn => btn.addEventListener("click", () => setTab(btn.dataset.tab)));
setTab("tasksTab");

function setSubtab(subId) {
  document.querySelectorAll(".subtab").forEach(t => t.classList.add("hidden"));
  const el = $(subId);
  el && el.classList.remove("hidden");
  subtabBtns.forEach(b => b.classList.toggle("active", b.dataset.subtab === subId));
}
subtabBtns.forEach(btn => btn.addEventListener("click", () => setSubtab(btn.dataset.subtab)));
setSubtab("employeesSub");

/* ---------------- header actions ---------------- */
reloadBtn && (reloadBtn.onclick = () => location.reload());
logoutBtn && (logoutBtn.onclick = async () => {
  try { await signOut(auth); } catch { }
  localStorage.removeItem("meName");
  localStorage.removeItem("meKey");
  location.reload();
});

/* ---------------- bootstrap meta docs ---------------- */
async function ensureCountsDoc_() {
  const snap = await getDoc(META_COUNTS_REF);
  if (!snap.exists()) {
    await setDoc(META_COUNTS_REF, { superCount: 0, adminCount: 0, updatedAt: serverTimestamp() }, { merge: true });
  }
}
async function ensureDayState_() {
  const snap = await getDoc(META_DAY_REF);
  if (!snap.exists()) {
    await setDoc(META_DAY_REF, { lastDayKey: "", updatedAt: serverTimestamp() }, { merge: true });
  }
}
async function getCounts_() {
  const snap = await getDoc(META_COUNTS_REF);
  return snap.exists() ? (snap.data() || {}) : { superCount: 0, adminCount: 0 };
}
async function setCounts_(superCount, adminCount) {
  await setDoc(META_COUNTS_REF, {
    superCount,
    adminCount,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || "unknown"
  }, { merge: true });
}

/* =========================================================
   ROLE SYSTEM (ADMIN = nameKey, nicht UID)
   - Rollen liegen in:
       superadmins_by_name/{nameKey}
       admins_by_name/{nameKey}
   - Benutzer-Gerät wechselt UID => user doc wird neu geschrieben, nameKey bleibt gleich
   ========================================================= */

async function refreshRole_() {
  isAdmin = false;
  isSuperAdmin = false;

  if (!meKey) {
    if (whoami) whoami.textContent = "—";
    adminTabBtn && adminTabBtn.classList.add("hidden");
    adminBadge && adminBadge.classList.add("hidden");
    show(adminLock, true);
    show(adminArea, false);
    show(newDailyTaskBtn, false);
    return;
  }

  const sSnap = await getDoc(doc(db, "superadmins_by_name", meKey));
  isSuperAdmin = sSnap.exists() && sSnap.data()?.enabled === true;

  const aSnap = await getDoc(doc(db, "admins_by_name", meKey));
  isAdmin = isSuperAdmin || (aSnap.exists() && aSnap.data()?.enabled === true);

  if (whoami) whoami.textContent = `${meName}${isSuperAdmin ? " · SUPERADMIN" : isAdmin ? " · ADMIN" : ""}`;

  adminBadge && adminBadge.classList.toggle("hidden", !isAdmin);
  show(adminLock, !isAdmin);
  show(adminArea, isAdmin);

  adminTabBtn && adminTabBtn.classList.toggle("hidden", !isAdmin);
  show(newDailyTaskBtn, isAdmin);

  if (adminUidAddBtn) adminUidAddBtn.disabled = !isSuperAdmin;
  if (superUidAddBtn) superUidAddBtn.disabled = !isSuperAdmin;
}

/* ---------------- enter app ---------------- */
function enterApp_() {
  show(loginView, false);
  show(appView, true);
  setTab("tasksTab");
}

/* ---------------- employees seed ---------------- */
async function seedFirstEmployeeIfEmpty_() {
  const snap = await getDocs(query(collection(db, "employees"), limit(1)));
  if (!snap.empty) return;

  const first = "Patrick";
  await setDoc(doc(db, "employees", keyOfName(first)), {
    name: first,
    passHash: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    seeded: true
  }, { merge: true });
}

/* ---------------- employees render ---------------- */
function renderEmployeeSelectors_() {
  const opts = [`<option value="">Name wählen…</option>`].concat(
    employees.map(x => `<option value="${esc(x.name)}">${esc(x.name)}</option>`)
  ).join("");

  if (nameSel) nameSel.innerHTML = opts;
  if (rideNameSel) rideNameSel.innerHTML = opts;

  if (doneBySel) {
    doneBySel.innerHTML = employees.map(x => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join("");
  }

  const stored = n(localStorage.getItem("meName"));
  if (stored) {
    nameSel && (nameSel.value = stored);
    rideNameSel && (rideNameSel.value = stored);
  }
}

/* ---------------- vacations (pro user) ---------------- */
async function loadVacation_() {
  if (!meKey) return;
  const ref = doc(db, "vacations", meKey);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const d = snap.data() || {};
    myVacation = { from: n(d.from || ""), until: n(d.until || "") };
  } else {
    myVacation = { from: "", until: "" };
  }
  renderVacationInfo_();
}
function isInVacation_() {
  if (!myVacation?.from || !myVacation?.until) return false;
  const t = dayKeyNow();
  return t >= myVacation.from && t <= myVacation.until;
}
function renderVacationInfo_() {
  if (!vacInfo) return;
  if (isInVacation_()) vacInfo.textContent = `Urlaub aktiv: ${myVacation.from} bis ${myVacation.until} (stumm).`;
  else if (myVacation.from && myVacation.until) vacInfo.textContent = `Urlaub gespeichert: ${myVacation.from} bis ${myVacation.until}.`;
  else vacInfo.textContent = "Kein Urlaub aktiv.";
}
vacSaveBtn && (vacSaveBtn.onclick = async () => {
  if (!meKey) return alertSafe_("Bitte einloggen.");
  const f = n(vacFrom?.value), u = n(vacUntil?.value);
  if (!/^\d{8}$/.test(f) || !/^\d{8}$/.test(u)) return alertSafe_("Datum als YYYYMMDD.");
  await setDoc(doc(db, "vacations", meKey), { name: meName, from: f, until: u, updatedAt: serverTimestamp() }, { merge: true });
  await loadVacation_();
});
vacClearBtn && (vacClearBtn.onclick = async () => {
  if (!meKey) return alertSafe_("Bitte einloggen.");
  await deleteDoc(doc(db, "vacations", meKey));
  await loadVacation_();
});

/* =========================================================
   LOGIN: Name aus employees + Passwort (1. Login setzt passHash)
   WICHTIG: Danach schreiben wir users/{uid} mit nameKey
   ========================================================= */
loginBtn && (loginBtn.onclick = async () => {
  loginErr && (loginErr.textContent = "");

  const nm = n(nameSel?.value);
  const pw = n(passInp?.value);

  if (!nm) return (loginErr.textContent = "Bitte Name wählen.");
  if (!pw) return (loginErr.textContent = "Bitte Passwort eingeben.");

  await ensureAnon_();

  const nk = keyOfName(nm);

  // employee doc lesen
  const eRef = doc(db, "employees", nk);
  const eSnap = await getDoc(eRef);
  if (!eSnap.exists()) {
    loginErr.textContent = "Name existiert nicht. Admin muss ihn anlegen.";
    return;
  }
  const eData = eSnap.data() || {};
  const existing = n(eData.passHash || "");

  const h = await passHashFor(nm, pw);

  if (!existing) {
    // erster Login => passHash setzen (Rules erlauben das nur, wenn passHash leer ist)
    await setDoc(eRef, { name: nm, passHash: h, updatedAt: serverTimestamp() }, { merge: true });
  } else {
    if (existing !== h) {
      loginErr.textContent = "Falsches Passwort.";
      return;
    }
  }

  // local state
  meName = nm;
  meKey = nk;

  localStorage.setItem("meName", meName);
  localStorage.setItem("meKey", meKey);

  // users/{uid} schreiben (damit Rules myNameKey() kennen)
  await setDoc(doc(db, "users", auth.currentUser.uid), {
    name: meName,
    nameKey: meKey,
    updatedAt: serverTimestamp()
  }, { merge: true });

  // Bootstrap: falls noch kein Superadmin existiert -> erster Name wird Superadmin
  await bootstrapFirstSuperAdminByName_();

  await refreshRole_();
  await loadVacation_();

  enterApp_();
});

/* ---------------- Bootstrap first superadmin (by name) ---------------- */
async function bootstrapFirstSuperAdminByName_() {
  if (!meKey) return;

  await ensureCountsDoc_();
  const counts = await getCounts_();

  // wenn bereits ein Superadmin existiert -> nichts tun
  if (Number(counts.superCount || 0) > 0) return;

  // erster Login darf Superadmin werden (Rules erlauben create wenn superCount==0)
  await setDoc(doc(db, "superadmins_by_name", meKey), {
    enabled: true,
    addedAt: serverTimestamp(),
    addedBy: "BOOTSTRAP"
  }, { merge: true });

  await setCounts_(1, Number(counts.adminCount || 0));
}

/* =========================================================
   TAGS
   ========================================================= */
function renderTags_() {
  if (!tagList) return;
  const qtxt = n(tagSearch?.value).toLowerCase();

  const list = tags.filter(t => {
    const tid = String(t.tagId || t.id || "").toLowerCase();
    return !qtxt || tid.includes(qtxt);
  });

  tagList.innerHTML = "";
  if (!list.length) {
    tagList.innerHTML = `<div class="muted">Keine Tags.</div>`;
    return;
  }

  list.forEach(t => {
    const tid = t.tagId || t.id;
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="main">
        <div class="title">🏷️ ${esc(tid)}</div>
        <div class="sub muted small">${esc(t.id)}</div>
      </div>
      <div class="actions"><button class="btn ghost">Öffnen</button></div>
    `;
    div.querySelector("button").onclick = () => openTag_(tid);
    tagList.appendChild(div);
  });
}

function renderAdminTags_() {
  if (!adminTagList) return;
  adminTagList.innerHTML = "";
  tags.forEach(t => {
    const tid = t.tagId || t.id;
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="main">
        <div class="title">🏷️ ${esc(tid)}</div>
        <div class="sub muted small">${esc(t.id)}</div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-open="1">Öffnen</button>
        <button class="btn danger" data-del="1">Löschen</button>
      </div>
    `;
    div.querySelector('[data-open="1"]').onclick = () => openTag_(tid);
    div.querySelector('[data-del="1"]').onclick = async () => {
      if (!confirm(`Tag "${tid}" löschen?`)) return;
      await deleteDoc(doc(db, "tags", t.id));
    };
    adminTagList.appendChild(div);
  });
}

function renderPlanTagSel_() {
  if (!planTagSel) return;
  planTagSel.innerHTML = tags.map(t => `<option value="${esc(t.tagId || t.id)}">${esc(t.tagId || t.id)}</option>`).join("");
}

/* ---------------- open/close tag ---------------- */
closeTagBtn && (closeTagBtn.onclick = () => closeTag_());

async function openTag_(tagId) {
  currentTagId = n(tagId);
  currentTagKey = keyOfName(currentTagId);
  selectedTaskId = "";

  if (openTagTitle) openTagTitle.textContent = `Tag: ${currentTagId}`;
  if (tagMeta) tagMeta.textContent = `Heute: ${dayKeyNow()} · ${isAdmin ? "Admin sieht alles" : "User sieht nur offene"}`;

  await listenTasksForCurrentTag_();
}

function closeTag_() {
  currentTagId = "";
  currentTagKey = "";
  selectedTaskId = "";
  if (openTagTitle) openTagTitle.textContent = "Kein Tag geöffnet";
  if (tagMeta) tagMeta.textContent = "";
  if (taskList) taskList.innerHTML = "";
  if (unsubTasks) { unsubTasks(); unsubTasks = null; }
}

/* =========================================================
   DAILY TASKS
   ========================================================= */
async function listenTasksForCurrentTag_() {
  if (!currentTagKey) return;

  if (unsubTasks) unsubTasks();

  const today = dayKeyNow();

  const q = isAdmin
    ? query(
      collection(db, "daily_tasks"),
      where("dateKey", "==", today),
      where("tagKey", "==", currentTagKey),
      orderBy("text")
    )
    : query(
      collection(db, "daily_tasks"),
      where("dateKey", "==", today),
      where("tagKey", "==", currentTagKey),
      where("status", "==", "open"),
      orderBy("text")
    );

  unsubTasks = ultraListen_(q, (docs) => {
    const tasks = docs.map(d => ({ id: d.id, ...d.data() }));
    renderTasks_(tasks);
  });
}

function renderTasks_(tasks) {
  if (!taskList) return;
  taskList.innerHTML = "";

  if (!tasks.length) {
    taskList.innerHTML = `<div class="muted">Keine Aufgaben für heute.</div>`;
    return;
  }

  tasks.forEach(t => {
    const div = document.createElement("div");
    div.className = "item";

    const doneByTxt = Array.isArray(t.doneBy) ? t.doneBy.join(", ") : "";
    const st = t.status || "open";

    div.innerHTML = `
      <div class="main">
        <div class="title">${st === "open" ? "⏳" : st === "done" ? "✅" : "🧾"} ${esc(t.text || "")}</div>
        <div class="sub muted small">
          ${doneByTxt ? `Erledigt von: ${esc(doneByTxt)}` : ""}
          ${t.finalOk ? ` · Endkontrolle: ${esc(t.finalBy || "")}` : ""}
        </div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-select="1">${selectedTaskId === t.id ? "✓" : "Auswählen"}</button>
        ${isAdmin ? `<button class="btn danger" data-del="1">🗑️</button>` : ``}
      </div>
    `;

    div.querySelector('[data-select="1"]').onclick = () => {
      selectedTaskId = t.id;
      taskHint && (taskHint.textContent = `Ausgewählt: ${t.text || ""}`);
      renderTasks_(tasks);
    };

    if (isAdmin) {
      div.querySelector('[data-del="1"]').onclick = async () => {
        if (!confirm("Aufgabe löschen?")) return;
        await deleteDoc(doc(db, "daily_tasks", t.id));
      };
    }

    taskList.appendChild(div);
  });
}

markSelectedDoneBtn && (markSelectedDoneBtn.onclick = async () => {
  if (!selectedTaskId) return alertSafe_("Bitte erst eine Aufgabe auswählen.");
  const selected = Array.from(doneBySel?.selectedOptions || []).map(o => n(o.value)).filter(Boolean);
  if (!selected.length) return alertSafe_("Bitte mindestens einen Mitarbeiter auswählen.");

  const ref = doc(db, "daily_tasks", selectedTaskId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return alertSafe_("Aufgabe nicht gefunden.");

  const t = snap.data() || {};
  if (t.status !== "open") return alertSafe_("Diese Aufgabe ist bereits erledigt.");

  await updateDoc(ref, {
    status: "done",
    doneBy: uniq(selected),
    doneAt: stamp(),
    updatedAt: serverTimestamp()
  });

  selectedTaskId = "";
  taskHint && (taskHint.textContent = "");
});

newDailyTaskBtn && (newDailyTaskBtn.onclick = async () => {
  if (!isAdmin) return alertSafe_("Nur Admin.");
  if (!currentTagKey) return alertSafe_("Erst Tag öffnen.");

  const txt = prompt("Neue Tagesaufgabe:");
  if (!txt) return;

  await addDoc(collection(db, "daily_tasks"), {
    dateKey: dayKeyNow(),
    tagId: currentTagId,
    tagKey: currentTagKey,
    text: n(txt),
    status: "open",
    doneBy: [],
    doneAt: "",
    finalOk: false,
    finalBy: "",
    finalAt: "",
    pointsBooked: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    source: "manual"
  });
});

/* =========================================================
   WEEKLY TASKS + DAYCHANGE
   ========================================================= */
planAddBtn && (planAddBtn.onclick = async () => {
  if (!isAdmin) return alertSafe_("Nur Admin.");

  const wd = Number(planWeekdaySel?.value || 0);
  const tagId = n(planTagSel?.value);
  const text = n(planTaskInp?.value);

  if (!(wd >= 1 && wd <= 6)) return alertSafe_("Wochentag (Mo–Sa) wählen.");
  if (!tagId) return alertSafe_("Tag wählen.");
  if (!text) return alertSafe_("Text fehlt.");

  await addDoc(collection(db, "weekly_tasks"), {
    weekday: wd,
    active: true,
    tagId,
    tagKey: keyOfName(tagId),
    text,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  planTaskInp && (planTaskInp.value = "");
});

function renderWeeklyList_(rows) {
  if (!planList) return;
  planList.innerHTML = "";

  if (!rows.length) {
    planList.innerHTML = `<div class="muted">Keine Wochenplan-Aufgaben.</div>`;
    return;
  }

  rows.forEach(r => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="main">
        <div class="title">${esc(r.text || "")}</div>
        <div class="sub muted small">Tag: ${esc(r.tagId || "")} · weekday: ${r.weekday}</div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-edit="1">✏️</button>
        <button class="btn danger" data-del="1">🗑️</button>
      </div>
    `;

    div.querySelector('[data-edit="1"]').onclick = async () => {
      const nt = prompt("Text:", r.text || "");
      if (nt == null) return;
      await updateDoc(doc(db, "weekly_tasks", r.id), { text: n(nt), updatedAt: serverTimestamp() });
    };

    div.querySelector('[data-del="1"]').onclick = async () => {
      if (!confirm("Wochenplan-Aufgabe löschen?")) return;
      await deleteDoc(doc(db, "weekly_tasks", r.id));
    };

    planList.appendChild(div);
  });
}

async function generateTodayFromWeekly_(todayKey) {
  const wd = weekdayNow();
  if (wd === 7) return; // Sonntag frei

  const weeklyQ = query(
    collection(db, "weekly_tasks"),
    where("weekday", "==", wd),
    where("active", "==", true),
    orderBy("tagKey"),
    orderBy("text")
  );

  const snap = await getDocs(weeklyQ);

  // vorhandene daily_tasks heute
  const exSnap = await getDocs(query(collection(db, "daily_tasks"), where("dateKey", "==", todayKey)));
  const exSet = new Set(exSnap.docs.map(d => {
    const x = d.data() || {};
    return `${x.tagKey || ""}|${String(x.text || "").toLowerCase()}`;
  }));

  const batch = writeBatch(db);
  let created = 0;

  snap.docs.forEach(d => {
    const w = d.data() || {};
    const k = `${w.tagKey || ""}|${String(w.text || "").toLowerCase()}`;
    if (exSet.has(k)) return;

    const ref = doc(collection(db, "daily_tasks"));
    batch.set(ref, {
      dateKey: todayKey,
      tagId: w.tagId,
      tagKey: w.tagKey,
      text: w.text,
      status: "open",
      doneBy: [],
      doneAt: "",
      finalOk: false,
      finalBy: "",
      finalAt: "",
      pointsBooked: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      source: "weekly"
    });
    created++;
  });

  if (created > 0) await batch.commit();
}

async function runDayChange_() {
  const today = dayKeyNow();

  await ensureDayState_();
  const stSnap = await getDoc(META_DAY_REF);
  const last = stSnap.exists() ? n((stSnap.data() || {}).lastDayKey) : "";

  if (last === today) return;

  // gestern archivieren + löschen
  if (last) {
    const snap = await getDocs(query(collection(db, "daily_tasks"), where("dateKey", "==", last)));
    const batch = writeBatch(db);
    snap.docs.forEach(d => {
      batch.set(doc(db, "archives", last, "tasks", d.id), { ...d.data(), archivedAt: serverTimestamp() }, { merge: true });
      batch.delete(d.ref);
    });
    if (!snap.empty) await batch.commit();
  }

  await setDoc(META_DAY_REF, { lastDayKey: today, updatedAt: serverTimestamp() }, { merge: true });

  await generateTodayFromWeekly_(today);
  await cleanupRides72h_();
}

function scheduleMidnightJob_() {
  setTimeout(async () => {
    try {
      await runDayChange_();
      if (currentTagKey) await listenTasksForCurrentTag_();
      await refreshFinalList_();
      await refreshPointsList_();
    } catch { }
    scheduleMidnightJob_();
  }, msUntilMidnight() + 1000);
}

forceDayChangeBtn && (forceDayChangeBtn.onclick = async () => {
  if (!isAdmin) return alertSafe_("Nur Admin.");
  if (!confirm("Tageswechsel jetzt ausführen?")) return;
  await runDayChange_();
  alertSafe_("Tageswechsel ✓");
});

regenTodayBtn && (regenTodayBtn.onclick = async () => {
  if (!isAdmin) return alertSafe_("Nur Admin.");
  await generateTodayFromWeekly_(dayKeyNow());
  alertSafe_("Heute neu erzeugt ✓");
});

/* =========================================================
   POINTS (Tasks + Rides getrennt)
   ========================================================= */
async function addPointsTask_(name, delta) {
  const id = keyOfName(name);
  const ref = doc(db, "points_tasks", id);
  const snap = await getDoc(ref);
  const cur = snap.exists() ? Number((snap.data() || {}).points || 0) : 0;
  await setDoc(ref, { name, points: cur + delta, updatedAt: serverTimestamp() }, { merge: true });
}

async function addPointsRide_(name, delta) {
  const id = keyOfName(name);
  const ref = doc(db, "points_rides", id);
  const snap = await getDoc(ref);
  const cur = snap.exists() ? Number((snap.data() || {}).points || 0) : 0;
  await setDoc(ref, { name, points: cur + delta, updatedAt: serverTimestamp() }, { merge: true });
}

async function bookTaskPointsOnce_(taskId) {
  const ref = doc(db, "daily_tasks", taskId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const t = snap.data() || {};
  if (t.pointsBooked === true) return;

  const people = uniq(Array.isArray(t.doneBy) ? t.doneBy : []);
  if (!people.length) {
    await updateDoc(ref, { pointsBooked: true, updatedAt: serverTimestamp() });
    return;
  }

  for (const p of people) {
    await addPointsTask_(p, 1);
  }

  await updateDoc(ref, { pointsBooked: true, updatedAt: serverTimestamp() });
}

async function refreshPointsList_() {
  if (!pointsList) return;

  const [tSnap, rSnap] = await Promise.all([
    getDocs(query(collection(db, "points_tasks"), orderBy("name"))).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, "points_rides"), orderBy("name"))).catch(() => ({ docs: [] })),
  ]);

  const map = new Map();

  (tSnap.docs || []).forEach(d => {
    const x = d.data() || {};
    map.set(d.id, { name: x.name || d.id, taskPoints: Number(x.points || 0), ridePoints: 0 });
  });

  (rSnap.docs || []).forEach(d => {
    const x = d.data() || {};
    const cur = map.get(d.id) || { name: x.name || d.id, taskPoints: 0, ridePoints: 0 };
    cur.ridePoints = Number(x.points || 0);
    map.set(d.id, cur);
  });

  const rows = Array.from(map.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  pointsList.innerHTML = rows.length ? "" : `<div class="muted">Noch keine Punkte.</div>`;

  rows.forEach(r => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="main">
        <div class="title">${esc(r.name)}</div>
        <div class="sub muted small">Aufgabenpunkte: ${r.taskPoints} · Fahrtenpunkte: ${r.ridePoints}</div>
      </div>
    `;
    pointsList.appendChild(div);
  });
}

/* =========================================================
   FINAL CHECK (Admin) -> bucht Punkte
   ========================================================= */
async function refreshFinalList_() {
  if (!isAdmin || !finalList) { if (finalList) finalList.innerHTML = ""; return; }

  const today = dayKeyNow();
  const q = query(
    collection(db, "daily_tasks"),
    where("dateKey", "==", today),
    where("status", "==", "done"),
    orderBy("tagKey"),
    orderBy("text")
  );

  if (unsubFinal) unsubFinal();
  unsubFinal = ultraListen_(q, (docs) => {
    const rows = docs.map(d => ({ id: d.id, ...d.data() }));

    finalList.innerHTML = rows.length ? "" : `<div class="muted">Keine erledigten Aufgaben für Endkontrolle.</div>`;

    rows.forEach(r => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="main">
          <div class="title">✅ ${esc(r.text || "")}</div>
          <div class="sub muted small">Tag: ${esc(r.tagId || "")} · Erledigt von: ${esc((r.doneBy || []).join(", "))}</div>
        </div>
        <div class="actions">
          <button class="btn ghost" data-final="1">${r.finalOk ? "🧾 OK" : "🧾 Endkontrolle"}</button>
        </div>
      `;

      div.querySelector('[data-final="1"]').onclick = async () => {
        const ref = doc(db, "daily_tasks", r.id);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;

        const t = snap.data() || {};
        if (t.finalOk) return alertSafe_("Endkontrolle ist bereits gesetzt.");

        await updateDoc(ref, {
          finalOk: true,
          finalBy: meName || "Admin",
          finalAt: stamp(),
          status: "final",
          updatedAt: serverTimestamp()
        });

        await bookTaskPointsOnce_(r.id);
        await refreshPointsList_();
      };

      finalList.appendChild(div);
    });
  });
}

/* =========================================================
   RIDES (72h) + points_rides
   ========================================================= */
function nowMs() { return Date.now(); }

addRideBtn && (addRideBtn.onclick = async () => {
  const nm = n(rideNameSel?.value) || meName;
  const eins = n(rideEinsatz?.value);
  if (!nm) return alertSafe_("Name fehlt.");
  if (!eins) return alertSafe_("Einsatznummer fehlt.");

  await addDoc(collection(db, "rides"), {
    name: nm,
    nameKey: keyOfName(nm),
    einsatz: eins,
    at: stamp(),
    createdMs: nowMs(),
    createdAt: serverTimestamp()
  });

  await addPointsRide_(nm, 1);

  rideEinsatz && (rideEinsatz.value = "");
  rideInfo && (rideInfo.textContent = "Gespeichert ✓ (+1 Fahrtenpunkt)");
  setTimeout(() => { rideInfo && (rideInfo.textContent = ""); }, 1500);

  await refreshPointsList_();
});

async function cleanupRides72h_() {
  const cutoff = nowMs() - (72 * 60 * 60 * 1000);
  const snap = await getDocs(query(collection(db, "rides"), orderBy("createdMs")));
  const old = snap.docs.filter(d => Number((d.data() || {}).createdMs || 0) < cutoff);
  if (!old.length) return;
  const batch = writeBatch(db);
  old.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

function renderRides_(rows) {
  if (!ridesList) return;

  rows.sort((a, b) => Number(b.createdMs || 0) - Number(a.createdMs || 0));
  ridesList.innerHTML = rows.length ? "" : `<div class="muted">Keine Fahrten in den letzten 72h.</div>`;

  rows.forEach(r => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="main">
        <div class="title">🚗 ${esc(r.name || "")} · ${esc(r.einsatz || "")}</div>
        <div class="sub muted small">${esc(r.at || "")}</div>
      </div>
      ${isAdmin ? `<div class="actions"><button class="btn danger">🗑️</button></div>` : ``}
    `;
    if (isAdmin) {
      div.querySelector("button").onclick = async () => {
        if (!confirm("Fahrt löschen?")) return;
        await deleteDoc(doc(db, "rides", r.id));
      };
    }
    ridesList.appendChild(div);
  });
}

/* =========================================================
   ADMIN: employees + tags + roles
   ========================================================= */
empAddBtn && (empAddBtn.onclick = async () => {
  if (!isAdmin) return alertSafe_("Nur Admin.");
  const nm = n(empAdd?.value);
  if (!nm) return alertSafe_("Name fehlt.");
  await setDoc(doc(db, "employees", keyOfName(nm)), { name: nm, passHash: "", updatedAt: serverTimestamp() }, { merge: true });
  empAdd && (empAdd.value = "");
});

function renderEmployeesAdmin_() {
  if (!empList) return;
  empList.innerHTML = "";

  employees.forEach(e => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="main">
        <div class="title">${esc(e.name)}</div>
        <div class="sub muted small">pass gesetzt: ${e.passHash ? "ja" : "nein"}</div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-reset="1">Reset PW</button>
        <button class="btn danger" data-del="1">🗑️</button>
      </div>
    `;
    div.querySelector('[data-reset="1"]').onclick = async () => {
      if (!confirm(`Passwort für "${e.name}" zurücksetzen?`)) return;
      await updateDoc(doc(db, "employees", keyOfName(e.name)), { passHash: "", updatedAt: serverTimestamp() });
    };
    div.querySelector('[data-del="1"]').onclick = async () => {
      if (!confirm(`"${e.name}" löschen?`)) return;
      await deleteDoc(doc(db, "employees", keyOfName(e.name)));
    };
    empList.appendChild(div);
  });
}

tagAddBtn && (tagAddBtn.onclick = async () => {
  if (!isAdmin) return alertSafe_("Nur Admin.");
  const tid = n(tagAdd?.value);
  if (!tid) return alertSafe_("Tag_ID fehlt.");
  await setDoc(doc(db, "tags", keyOfName(tid)), { tagId: tid, tagKey: keyOfName(tid), updatedAt: serverTimestamp() }, { merge: true });
  tagAdd && (tagAdd.value = "");
});

/* Roles: Admin/Superadmin by nameKey (keine UID mehr nötig) */
async function renderAdminsByName_(docs) {
  if (!adminUidList) return;
  adminUidList.innerHTML = docs.length ? "" : `<div class="muted">Keine Admins.</div>`;
  docs.forEach(r => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="main">
        <div class="title">ADMIN: ${esc(r.id)}</div>
        <div class="sub muted small">enabled: ${String(r.enabled === true)}</div>
      </div>
      <div class="actions"><button class="btn danger">Entfernen</button></div>
    `;
    div.querySelector("button").onclick = async () => {
      if (!isSuperAdmin) return alertSafe_("Nur Superadmin.");
      if (!confirm("Admin entfernen?")) return;
      await deleteDoc(doc(db, "admins_by_name", r.id));

      const c = await getCounts_();
      await setCounts_(Number(c.superCount || 0), Math.max(0, Number(c.adminCount || 0) - 1));
    };
    adminUidList.appendChild(div);
  });
}

async function renderSupersByName_(docs) {
  if (!superUidList) return;
  superUidList.innerHTML = docs.length ? "" : `<div class="muted">Keine Superadmins?</div>`;
  docs.forEach(r => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="main">
        <div class="title">SUPERADMIN: ${esc(r.id)}</div>
        <div class="sub muted small">enabled: ${String(r.enabled === true)}</div>
      </div>
      <div class="actions"><button class="btn danger">Entfernen</button></div>
    `;
    div.querySelector("button").onclick = async () => {
      if (!isSuperAdmin) return alertSafe_("Nur Superadmin.");
      const c = await getCounts_();
      if (Number(c.superCount || 0) <= 1) return alertSafe_("Mindestens 1 Superadmin muss bleiben.");
      if (!confirm("Superadmin entfernen?")) return;

      await deleteDoc(doc(db, "superadmins_by_name", r.id));
      await setCounts_(Math.max(1, Number(c.superCount || 0) - 1), Number(c.adminCount || 0));
    };
    superUidList.appendChild(div);
  });
}

/* Admin hinzufügen (nameKey) */
adminUidAddBtn && (adminUidAddBtn.onclick = async () => {
  if (!isSuperAdmin) return alertSafe_("Nur Superadmin.");

  const nameKey = keyOfName(n(adminUidAdd?.value));
  if (!nameKey) return alertSafe_("Bitte nameKey eintragen (z.B. patrick).");

  await ensureCountsDoc_();
  const c = await getCounts_();
  if (Number(c.adminCount || 0) >= MAX_ADMIN) return alertSafe_(`Maximal ${MAX_ADMIN} Admins erreicht.`);

  await setDoc(doc(db, "admins_by_name", nameKey), { enabled: true, addedAt: serverTimestamp(), addedBy: meKey }, { merge: true });
  await setCounts_(Number(c.superCount || 0), Number(c.adminCount || 0) + 1);

  adminUidAdd && (adminUidAdd.value = "");
});

/* Superadmin hinzufügen (nameKey) */
superUidAddBtn && (superUidAddBtn.onclick = async () => {
  if (!isSuperAdmin) return alertSafe_("Nur Superadmin.");

  const nameKey = keyOfName(n(superUidAdd?.value));
  if (!nameKey) return alertSafe_("Bitte nameKey eintragen (z.B. patrick).");

  await ensureCountsDoc_();
  const c = await getCounts_();
  if (Number(c.superCount || 0) >= MAX_SUPER) return alertSafe_(`Maximal ${MAX_SUPER} Superadmins erreicht.`);

  await setDoc(doc(db, "superadmins_by_name", nameKey), { enabled: true, addedAt: serverTimestamp(), addedBy: meKey }, { merge: true });
  await setCounts_(Number(c.superCount || 0) + 1, Number(c.adminCount || 0));

  superUidAdd && (superUidAdd.value = "");
});

/* =========================================================
   STREAMS / INIT
   ========================================================= */
async function startStreams_() {
  // employees
  unsubEmployees && unsubEmployees();
  unsubEmployees = ultraListen_(query(collection(db, "employees"), orderBy("name")), (docs) => {
    employees = docs.map(d => ({ id: d.id, ...d.data() }));
    renderEmployeeSelectors_();
    if (isAdmin) renderEmployeesAdmin_();
  });

  // tags
  unsubTags && unsubTags();
  unsubTags = ultraListen_(query(collection(db, "tags"), orderBy("tagId")), (docs) => {
    tags = docs.map(d => ({ id: d.id, ...d.data() }));
    renderTags_();
    if (isAdmin) {
      renderAdminTags_();
      renderPlanTagSel_();
    }
  });

  // rides
  unsubRides && unsubRides();
  unsubRides = ultraListen_(query(collection(db, "rides"), orderBy("createdMs")), (docs) => {
    const cutoff = nowMs() - (72 * 60 * 60 * 1000);
    const rows = docs.map(d => ({ id: d.id, ...d.data() })).filter(r => Number(r.createdMs || 0) >= cutoff);
    renderRides_(rows);
  });

  // weekly list (admin)
  const refreshWeekly = () => {
    if (!isAdmin) return;
    unsubWeekly && unsubWeekly();

    const wd = Number(planWeekdaySel?.value || 1);
    const tagId = n(planTagSel?.value);
    const tk = keyOfName(tagId);

    const q = query(
      collection(db, "weekly_tasks"),
      where("weekday", "==", wd),
      where("tagKey", "==", tk),
      orderBy("text")
    );

    unsubWeekly = ultraListen_(q, (docs) => {
      const rows = docs.map(d => ({ id: d.id, ...d.data() }));
      renderWeeklyList_(rows);
    });
  };

  planWeekdaySel && (planWeekdaySel.onchange = refreshWeekly);
  planTagSel && (planTagSel.onchange = refreshWeekly);
  setTimeout(() => { try { refreshWeekly(); } catch { } }, 600);

  // roles lists (admin)
  unsubAdmins && unsubAdmins();
  unsubAdmins = ultraListen_(query(collection(db, "admins_by_name"), orderBy("addedAt")), (docs) => {
    if (!isAdmin) return;
    renderAdminsByName_(docs.map(d => ({ id: d.id, ...d.data() })));
  });

  unsubSupers && unsubSupers();
  unsubSupers = ultraListen_(query(collection(db, "superadmins_by_name"), orderBy("addedAt")), (docs) => {
    if (!isAdmin) return;
    renderSupersByName_(docs.map(d => ({ id: d.id, ...d.data() })));
  });

  tagSearch && (tagSearch.oninput = () => renderTags_());

  await refreshFinalList_();
}

/* ---------------- init ---------------- */
onAuthStateChanged(auth, async () => {
  await ensureAnon_();

  dayKeyBadge && (dayKeyBadge.textContent = dayKeyNow());

  await ensureCountsDoc_();
  await ensureDayState_();
  await seedFirstEmployeeIfEmpty_();

  // Tageswechsel nachholen + 00:00 Scheduler
  await runDayChange_();
  scheduleMidnightJob_();

  // rides cleanup hourly
  setInterval(() => { cleanupRides72h_().catch(() => { }); }, 60 * 60 * 1000);

  // restore login
  const storedName = n(localStorage.getItem("meName"));
  const storedKey = n(localStorage.getItem("meKey"));
  if (storedName) {
    meName = storedName;
    meKey = storedKey || keyOfName(meName);

    // wichtig: users/{uid} setzen, damit Rules myNameKey haben (Device wechsel = neue UID)
    await setDoc(doc(db, "users", auth.currentUser.uid), {
      name: meName,
      nameKey: meKey,
      updatedAt: serverTimestamp()
    }, { merge: true });

    // bootstrap nur falls superCount==0
    await bootstrapFirstSuperAdminByName_();
  }

  await refreshRole_();
  await startStreams_();
  await refreshPointsList_();

  if (meName) {
    await loadVacation_();
    enterApp_();
    if (currentTagKey) await listenTasksForCurrentTag_();
  } else {
    show(loginView, true);
    show(appView, false);
  }
});
