import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, serverTimestamp, getDocs, writeBatch, limit
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================================================
   Aufgabenliste ZDL RA 93 — ULTRA (Zero Setup)
   - Anonymous Auth
   - Login via employees_public dropdown
   - Auto-seed first employee: Patrick (if empty)
   - Everyone sees all tags, but NORMAL users see ONLY open tasks
   - Multi-select completion: set doneBy[] in one shot
   - Once ✅, normal users cannot re-check and do not see it
   - Admin tools: edit/delete/reset/final check, tag delete with tasks
   - Points: awarded ONLY when finalOk becomes true (Function)
   - Weekly templates: Mon-Sat; Sunday free
   - Daily rollover: auto 00:00 (Function); manual button as fallback
   - Rides visible 72h: today + yesterday + day-2
   - Vacation muteUntil saved per user (future push uses it)
   ========================================================= */

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
const db = getFirestore(app);

const MAX_SUPER = 10;
const MAX_ADMIN = 25;
const META_COUNTS_REF = doc(db, "meta", "admin_counts");

/* ---------------- helpers ---------------- */
const $ = (id) => document.getElementById(id);
const show = (el, on) => { if (el) el.classList.toggle("hidden", !on); };
const n = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const esc = (s) => String(s ?? "")
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
const key = (s) => n(s).toLowerCase().replace(/["'„“”]/g,"").replace(/[^a-z0-9äöüß]/g,"");

const stamp = () => {
  const d=new Date(); const p=(x)=>String(x).padStart(2,"0");
  return `${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const dayKey = (offsetDays=0) => {
  const d=new Date(Date.now() + offsetDays*24*60*60*1000);
  const p=(x)=>String(x).padStart(2,"0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`;
};

const uniq = (arr) => Array.from(new Set((arr||[]).map(x=>n(x)).filter(Boolean)));

async function alertSafe_(msg){ try{ alert(msg); }catch(e){} }

function parseDateInput_(s){
  const v = n(s);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [Y,M,D] = v.split("-").map(x=>Number(x));
  const dt = new Date(Y, M-1, D, 23, 59, 59, 999);
  if(isNaN(dt.getTime())) return null;
  return dt;
}
function fmtDate_(d){
  if(!d) return "";
  const p=(x)=>String(x).padStart(2,"0");
  return `${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()}`;
}

/* ---------------- DOM ---------------- */
const loginView = $("loginView");
const appView = $("appView");

const whoami = $("whoami");
const reloadBtn = $("reloadBtn");
const logoutBtn = $("logoutBtn");

const vacBtn = $("vacBtn");
const vacClearBtn = $("vacClearBtn");

const nameSel = $("nameSel");
const loginBtn = $("loginBtn");
const loginErr = $("loginErr");

const showUidBtn = $("showUidBtn");
const copyUidBtn = $("copyUidBtn");
const uidBox = $("uidBox");

const tagSearch = $("tagSearch");
const tagList = $("tagList");

const openTagTitle = $("openTagTitle");
const tagMeta = $("tagMeta");
const closeTagBtn = $("closeTagBtn");
const newTaskBtn = $("newTaskBtn");
const taskList = $("taskList");

// tabs
const tabs = document.querySelectorAll(".tab[data-tab]");
const tabTasks = $("tab_tasks");
const tabRides = $("tab_rides");
const tabAdmin = $("tab_admin");

// rides
const rideDaySel = $("rideDaySel");
const rideNameSel = $("rideNameSel");
const rideEinsatz = $("rideEinsatz");
const addRideBtn = $("addRideBtn");
const rideInfo = $("rideInfo");
const ridesList = $("ridesList");

// admin
const adminBadge = $("adminBadge");
const adminLock = $("adminLock");
const adminArea = $("adminArea");

// admin subtabs
const adminTabs = document.querySelectorAll(".tab[data-admintab]");
const admTools = $("adm_tools");
const admEmployees = $("adm_employees");
const admTags = $("adm_tags");
const admWeekly = $("adm_weekly");
const admAdmins = $("adm_admins");

const empAdd = $("empAdd");
const empAddBtn = $("empAddBtn");
const empList = $("empList");
const pointsList = $("pointsList");

const tagAdd = $("tagAdd");
const tagAddBtn = $("tagAddBtn");
const adminTagList = $("adminTagList");

const weekDaySel = $("weekDaySel");
const weekTagId = $("weekTagId");
const weekTaskText = $("weekTaskText");
const weekAddBtn = $("weekAddBtn");
const weeklyList = $("weeklyList");

const adminUidAdd = $("adminUidAdd");
const adminUidAddBtn = $("adminUidAddBtn");
const adminUidList = $("adminUidList");

const superUidAdd = $("superUidAdd");
const superUidAddBtn = $("superUidAddBtn");
const superUidList = $("superUidList");

const godSearch = $("godSearch");
const toggleOnlyOpenBtn = $("toggleOnlyOpenBtn");
const collapseAllBtn = $("collapseAllBtn");
const dayChangeBtn = $("dayChangeBtn");
const godSummary = $("godSummary");
const godList = $("godList");

/* ---------------- state ---------------- */
let meName = "";
let isAdmin = false;
let isSuperAdmin = false;

let muteUntil = null;

let employees = [];
let tags = [];
let allTasks = [];
let weeklyTemplates = [];

let currentTagId = "";
let currentTagKey = "";
let onlyOpen = false;

let unsub = []; // unsubscribe holders

/* ---------------- auth helpers ---------------- */
async function ensureAnon_(){
  if(auth.currentUser) return;
  await signInAnonymously(auth);
}

/* ---------------- counts doc ---------------- */
async function ensureCountsDoc_(){
  const snap = await getDoc(META_COUNTS_REF);
  if(!snap.exists()){
    await setDoc(META_COUNTS_REF, { superCount:0, adminCount:0, updatedAt:serverTimestamp() }, { merge:true });
  }
}
async function getCounts_(){
  const snap = await getDoc(META_COUNTS_REF);
  return snap.exists() ? (snap.data()||{}) : { superCount:0, adminCount:0 };
}
async function incCount_(field, delta){
  const snap = await getDoc(META_COUNTS_REF);
  const cur = snap.exists() ? (snap.data()||{}) : {};
  const next = Math.max(0, Number(cur[field]||0) + delta);
  await setDoc(META_COUNTS_REF, { [field]: next, updatedAt:serverTimestamp(), updatedBy: auth.currentUser.uid }, { merge:true });
}

/* ---------------- bootstrap: first superadmin ---------------- */
async function bootstrapSuperAdminOnce_(){
  const q1 = query(collection(db,"superadmins"), where("enabled","==",true), limit(1));
  const snap = await getDocs(q1);
  if(!snap.empty) return;

  await ensureCountsDoc_();

  await setDoc(doc(db,"superadmins",auth.currentUser.uid), {
    enabled:true, addedAt:serverTimestamp(), addedBy:"BOOTSTRAP"
  }, { merge:true });

  const counts = await getCounts_();
  if((counts.superCount||0) < 1){
    await setDoc(META_COUNTS_REF, { superCount:1 }, { merge:true });
  }
}

/* ---------------- seed first employee: Patrick ---------------- */
async function seedFirstEmployeeIfEmpty_(){
  const snap = await getDocs(query(collection(db,"employees_public"), limit(1)));
  if(!snap.empty) return;

  const firstName = "Patrick";
  await setDoc(doc(db,"employees_public", key(firstName)), {
    name: firstName,
    points: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    seeded: true
  }, { merge:true });
}

/* ---------------- role refresh ---------------- */
async function refreshRole_(){
  const uid = auth.currentUser.uid;

  const sdoc = await getDoc(doc(db,"superadmins",uid));
  isSuperAdmin = sdoc.exists() && sdoc.data()?.enabled === true;

  const adoc = await getDoc(doc(db,"admins",uid));
  isAdmin = isSuperAdmin || (adoc.exists() && adoc.data()?.enabled !== false);

  let label = `${meName || "—"}`;
  if(isSuperAdmin) label += " · SUPERADMIN";
  else if(isAdmin) label += " · ADMIN";

  if(muteUntil && muteUntil.getTime() > Date.now()){
    label += ` · Urlaub bis ${fmtDate_(muteUntil)}`;
  }

  if(whoami) whoami.textContent = label;

  if(adminBadge) adminBadge.classList.toggle("hidden", !isAdmin);
  show(adminLock, !isAdmin);
  show(adminArea, isAdmin);

  if(adminUidAddBtn) adminUidAddBtn.disabled = !isSuperAdmin;
  if(superUidAddBtn) superUidAddBtn.disabled = !isSuperAdmin;
}

/* ---------------- UI actions ---------------- */
reloadBtn && (reloadBtn.onclick = () => location.reload());

logoutBtn && (logoutBtn.onclick = async () => {
  try{ await signOut(auth); }catch(e){}
  localStorage.removeItem("meName");
  location.reload();
});

showUidBtn && (showUidBtn.onclick = async () => {
  await ensureAnon_();
  const uid = auth.currentUser.uid;
  if(uidBox) uidBox.textContent = uid;
  if(copyUidBtn) copyUidBtn.disabled = false;
  await alertSafe_("UID:\n" + uid + "\n\nSuper-Admin setzt dich frei via /superadmins/{UID} oder /admins/{UID}.");
});

copyUidBtn && (copyUidBtn.onclick = async () => {
  const uid = auth?.currentUser?.uid || "";
  if(!uid) return;
  try{ await navigator.clipboard.writeText(uid); await alertSafe_("UID kopiert ✓"); }
  catch(e){ await alertSafe_(uid); }
});

vacBtn && (vacBtn.onclick = async ()=>{
  if(!auth.currentUser){ alert("Bitte einloggen."); return; }
  const input = prompt("Urlaub bis (YYYY-MM-DD)\nBeispiel: 2026-03-01");
  if(input == null) return;
  const dt = parseDateInput_(input);
  if(!dt){ alert("Ungültiges Datum. Bitte YYYY-MM-DD."); return; }

  await setDoc(doc(db,"user_prefs",auth.currentUser.uid), {
    muteUntil: dt,
    updatedAt: serverTimestamp()
  }, { merge:true });

  alert("Urlaubsmodus aktiv bis " + fmtDate_(dt));
});

vacClearBtn && (vacClearBtn.onclick = async ()=>{
  if(!auth.currentUser) return;
  await setDoc(doc(db,"user_prefs",auth.currentUser.uid), {
    muteUntil: null,
    updatedAt: serverTimestamp()
  }, { merge:true });
  alert("Urlaubsmodus deaktiviert.");
});

loginBtn && (loginBtn.onclick = async () => {
  loginErr && (loginErr.textContent = "");
  const nm = n(nameSel?.value);
  if(!nm){
    if(loginErr) loginErr.textContent = "Bitte Name wählen.";
    return;
  }

  await ensureAnon_();
  meName = nm;
  localStorage.setItem("meName", nm);

  await setDoc(doc(db,"users",auth.currentUser.uid), { name:nm, updatedAt:serverTimestamp() }, { merge:true });

  await refreshRole_();
  enterApp_();
});

/* ---------------- tabs ---------------- */
function selectTab_(tab){
  [tabTasks, tabRides, tabAdmin].forEach(x=>x && x.classList.add("hidden"));
  document.querySelectorAll(".tab[data-tab]").forEach(b=>b.classList.remove("active"));

  if(tab === "tasks"){ tabTasks.classList.remove("hidden"); document.querySelector('.tab[data-tab="tasks"]').classList.add("active"); }
  if(tab === "rides"){ tabRides.classList.remove("hidden"); document.querySelector('.tab[data-tab="rides"]').classList.add("active"); renderRides_(); }
  if(tab === "admin"){ tabAdmin.classList.remove("hidden"); document.querySelector('.tab[data-tab="admin"]').classList.add("active"); }
}
tabs.forEach(b=>b.addEventListener("click", ()=>selectTab_(b.dataset.tab)));

function selectAdminTab_(t){
  [admTools, admEmployees, admTags, admWeekly, admAdmins].forEach(x=>x && x.classList.add("hidden"));
  adminTabs.forEach(b=>b.classList.remove("active"));

  const btn = document.querySelector(`.tab[data-admintab="${t}"]`);
  btn && btn.classList.add("active");

  if(t==="tools") admTools.classList.remove("hidden");
  if(t==="employees") admEmployees.classList.remove("hidden");
  if(t==="tags") admTags.classList.remove("hidden");
  if(t==="weekly") admWeekly.classList.remove("hidden");
  if(t==="admins") admAdmins.classList.remove("hidden");
}
adminTabs.forEach(b=>b.addEventListener("click", ()=>selectAdminTab_(b.dataset.admintab)));

/* ---------------- rides (72h) ---------------- */
rideDaySel && (rideDaySel.onchange = ()=>renderRides_());

addRideBtn && (addRideBtn.onclick = async () => {
  const nm = n(rideNameSel?.value) || meName || n(localStorage.getItem("meName"));
  const eins = n(rideEinsatz?.value);

  if(!nm){ await alertSafe_("Name fehlt."); return; }
  if(!eins){ await alertSafe_("Einsatznummer fehlt."); return; }

  const off = Number(rideDaySel?.value || 0);
  if(off !== 0){ await alertSafe_("Fahrten hinzufügen nur für HEUTE."); return; }

  const d = dayKey(0);
  const ref = doc(db,"rides_daily",d,"people",key(nm));
  const snap = await getDoc(ref);
  const data = snap.exists()?snap.data():{name:nm,rides:[]};

  const rides = Array.isArray(data.rides) ? data.rides.slice(0) : [];
  rides.push({ einsatz: eins, at: stamp() });

  await setDoc(ref, { name:nm, rides, updatedAt:serverTimestamp() }, { merge:true });

  if(rideEinsatz) rideEinsatz.value = "";
  if(rideInfo) rideInfo.textContent = "Gespeichert ✓";
  setTimeout(()=>{ if(rideInfo) rideInfo.textContent=""; }, 1200);
});

async function renderRides_(){
  if(!ridesList) return;

  const off = Number(rideDaySel?.value || 0);
  const d = dayKey(-off);

  ridesList.innerHTML = `<div class="muted">Lade…</div>`;
  const snap = await getDocs(query(collection(db,"rides_daily",d,"people"), orderBy("name")));
  const rows = snap.docs.map(x=>x.data());

  if(!rows.length){
    ridesList.innerHTML = `<div class="muted">Keine Fahrten (${d}).</div>`;
    return;
  }

  ridesList.innerHTML = "";
  for(const p of rows){
    const name = n(p.name);
    const rides = Array.isArray(p.rides) ? p.rides : [];
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="main">
        <div class="title">🚗 ${esc(name)} (${rides.length})</div>
        <div class="sub muted small">${rides.map(r=>esc(r.einsatz)).join(", ")}</div>
      </div>
    `;
    ridesList.appendChild(div);
  }
}

/* ---------------- admin: add employee ---------------- */
empAddBtn && (empAddBtn.onclick = async () => {
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  const nm = n(empAdd?.value);
  if(!nm){ await alertSafe_("Name fehlt."); return; }
  await setDoc(doc(db,"employees_public", key(nm)), { name:nm, points:0, updatedAt:serverTimestamp() }, { merge:true });
  if(empAdd) empAdd.value = "";
});

/* ---------------- admin: add tag ---------------- */
tagAddBtn && (tagAddBtn.onclick = async () => {
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  const tid = n(tagAdd?.value);
  if(!tid){ await alertSafe_("Tag_ID fehlt."); return; }
  await setDoc(doc(db,"tags", key(tid)), { tagId:tid, tagKey:key(tid), updatedAt:serverTimestamp() }, { merge:true });
  if(tagAdd) tagAdd.value = "";
});

/* ---------------- open/close tag ---------------- */
closeTagBtn && (closeTagBtn.onclick = () => closeTag_());

/* ---------------- add today extra task ---------------- */
newTaskBtn && (newTaskBtn.onclick = async () => {
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  if(!currentTagKey){ await alertSafe_("Erst Tag öffnen."); return; }
  const t = prompt("Neue Zusatzaufgabe (nur heute):");
  if(!t) return;

  await addDoc(collection(db,"daily_tasks"), {
    dayKey: dayKey(0),
    weekday: null,
    source: "extra",
    tagId: currentTagId,
    tagKey: currentTagKey,
    task: n(t),
    status: "❌",
    doneBy: [],
    doneAtLast: "",
    finalOk: false,
    finalBy: "",
    pointsAwarded: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
});

/* ---------------- superadmin: add admin/superadmin ---------------- */
adminUidAddBtn && (adminUidAddBtn.onclick = async () => {
  if(!isSuperAdmin){ await alertSafe_("Nur Super-Admin."); return; }
  const uid = n(adminUidAdd?.value);
  if(!uid){ await alertSafe_("UID fehlt."); return; }

  await ensureCountsDoc_();
  const counts = await getCounts_();
  if((counts.adminCount||0) >= MAX_ADMIN){
    await alertSafe_(`Maximal ${MAX_ADMIN} Admins erreicht.`);
    return;
  }
  await setDoc(doc(db,"admins",uid), { enabled:true, addedAt:serverTimestamp(), addedBy:auth.currentUser.uid }, { merge:true });
  await incCount_("adminCount", +1);
  if(adminUidAdd) adminUidAdd.value = "";
});

superUidAddBtn && (superUidAddBtn.onclick = async () => {
  if(!isSuperAdmin){ await alertSafe_("Nur Super-Admin."); return; }
  const uid = n(superUidAdd?.value);
  if(!uid){ await alertSafe_("UID fehlt."); return; }

  await ensureCountsDoc_();
  const counts = await getCounts_();
  if((counts.superCount||0) >= MAX_SUPER){
    await alertSafe_(`Maximal ${MAX_SUPER} Super-Admins erreicht.`);
    return;
  }
  await setDoc(doc(db,"superadmins",uid), { enabled:true, addedAt:serverTimestamp(), addedBy:auth.currentUser.uid }, { merge:true });
  await incCount_("superCount", +1);
  if(superUidAdd) superUidAdd.value = "";
});

/* ---------------- weekly templates (Mon-Sat) ---------------- */
weekAddBtn && (weekAddBtn.onclick = async ()=>{
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  const wd = Number(weekDaySel?.value || 0);
  const tagId = n(weekTagId?.value);
  const task = n(weekTaskText?.value);

  if(!(wd>=1 && wd<=6)){ await alertSafe_("Wochentag Mo–Sa wählen."); return; }
  if(!tagId){ await alertSafe_("Tag_ID fehlt."); return; }
  if(!task){ await alertSafe_("Aufgabe fehlt."); return; }

  // ensure tag exists too
  await setDoc(doc(db,"tags",key(tagId)), { tagId, tagKey:key(tagId), updatedAt:serverTimestamp() }, { merge:true });

  // order = timestamp
  await addDoc(collection(db,"weekly_templates"), {
    weekday: wd,
    tagId,
    tagKey: key(tagId),
    task,
    order: Date.now(),
    updatedAt: serverTimestamp()
  });

  if(weekTagId) weekTagId.value = "";
  if(weekTaskText) weekTaskText.value = "";
});

/* ---------------- dashboard controls ---------------- */
toggleOnlyOpenBtn && (toggleOnlyOpenBtn.onclick = () => {
  onlyOpen = !onlyOpen;
  renderGod_();
});
collapseAllBtn && (collapseAllBtn.onclick = () => {
  if(!godList) return;
  godList.querySelectorAll("details").forEach(d=>d.open=false);
});
dayChangeBtn && (dayChangeBtn.onclick = async () => {
  if(!isAdmin){ await alertSafe_("Nur Admin."); return; }
  if(!confirm("Manueller Tageswechsel?\n(Automatisch läuft er um 00:00)")) return;
  await runDayChangeManual_();
});

/* ---------------- render + streams ---------------- */
function enterApp_(){
  show(loginView,false);
  show(appView,true);
  selectTab_("tasks");
}

function renderEmployeeSelectors_(){
  const opts = [`<option value="">Name wählen…</option>`].concat(
    employees.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`)
  ).join("");

  if(nameSel) nameSel.innerHTML = opts;
  if(rideNameSel) rideNameSel.innerHTML = opts;

  const stored = n(localStorage.getItem("meName"));
  if(stored){
    if(nameSel) nameSel.value = stored;
    if(rideNameSel) rideNameSel.value = stored;
  }
}

function renderEmployeesAdmin_(){
  if(!empList) return;
  empList.innerHTML = "";
  employees.forEach(name=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main"><div class="title">${esc(name)}</div></div>
      <div class="actions"><button class="btn danger">🗑️</button></div>
    `;
    div.querySelector("button").onclick = async ()=>{
      if(!isAdmin) return;
      if(!confirm(`"${name}" löschen?`)) return;
      await deleteDoc(doc(db,"employees_public", key(name)));
    };
    empList.appendChild(div);
  });
}

function renderPoints_(){
  if(!pointsList) return;
  if(!isAdmin){ pointsList.innerHTML=""; return; }

  pointsList.innerHTML = "";
  employees.forEach(name=>{
    const k = key(name);
    const found = employeesPointsMap.get(k) ?? 0;
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">⭐ ${esc(name)}</div>
        <div class="sub muted small">Punkte: ${found}</div>
      </div>
    `;
    pointsList.appendChild(div);
  });
}

function renderTags_(){
  if(!tagList) return;
  const qtxt = n(tagSearch?.value).toLowerCase();

  const list = tags.filter(t=>{
    const tid = String(t.tagId || t.id || "").toLowerCase();
    return !qtxt || tid.includes(qtxt);
  });

  tagList.innerHTML = "";
  if(!list.length){
    tagList.innerHTML = `<div class="muted">Keine Tags.</div>`;
    return;
  }

  list.forEach(t=>{
    const tid = t.tagId || t.id;
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">🏷️ ${esc(tid)}</div>
        <div class="sub muted small">${esc(t.tagKey||t.id||"")}</div>
      </div>
      <div class="actions"><button class="btn ghost">Öffnen</button></div>
    `;
    div.querySelector("button").onclick = ()=>openTag_(tid);
    tagList.appendChild(div);
  });
}

function renderAdminTags_(){
  if(!adminTagList) return;
  if(!isAdmin){ adminTagList.innerHTML=""; return; }

  adminTagList.innerHTML = "";
  tags.forEach(t=>{
    const tid = t.tagId || t.id;
    const div = document.createElement("div");
    div.className="item";
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
    div.querySelector('[data-open="1"]').onclick = ()=>openTag_(tid);
    div.querySelector('[data-del="1"]').onclick = ()=>deleteTagWithTasks_(t.id, tid);
    adminTagList.appendChild(div);
  });
}

/* ---------------- Tag + tasks ---------------- */
let unsubTasks = null;

async function openTag_(tagId){
  currentTagId = n(tagId);
  currentTagKey = key(currentTagId);

  if(openTagTitle) openTagTitle.textContent = `Tag: ${currentTagId}`;
  if(tagMeta) tagMeta.textContent = `tagKey: ${currentTagKey}`;

  if(unsubTasks) unsubTasks();
  unsubTasks = onSnapshot(
    query(collection(db,"daily_tasks"), where("tagKey","==",currentTagKey), orderBy("task")),
    (snap)=>{
      const tasks = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderTasks_(tasks);
    }
  );
}

function closeTag_(){
  currentTagId = "";
  currentTagKey = "";
  if(openTagTitle) openTagTitle.textContent = "Kein Tag geöffnet";
  if(tagMeta) tagMeta.textContent = "";
  if(taskList) taskList.innerHTML = "";
  if(unsubTasks){ unsubTasks(); unsubTasks=null; }
}

function askMultiNames_(defaultName){
  const hint = employees.length ? `\nMögliche Namen: ${employees.join(", ")}` : "";
  const raw = prompt(`Wer hat erledigt? (Mehrfach möglich, mit Komma)\nBeispiel: Anna, Max${hint}`, defaultName || "");
  if(raw == null) return null;
  const list = raw.split(",").map(x=>n(x)).filter(Boolean);
  return uniq(list);
}

function renderTasks_(tasks){
  if(!taskList) return;
  taskList.innerHTML = "";

  // normal users see only open tasks
  const visible = isAdmin ? tasks : tasks.filter(t => (t.status||"❌") !== "✅");

  if(!visible.length){
    taskList.innerHTML = `<div class="muted">Keine Aufgaben.</div>`;
    return;
  }

  visible.forEach(t=>{
    const doneByTxt = Array.isArray(t.doneBy) ? t.doneBy.join(", ") : "";
    const div = document.createElement("div");
    div.className = "item";

    div.innerHTML = `
      <div class="main">
        <div class="title">${t.status==="✅"?"✅":"⏳"} ${esc(t.task||"")}</div>
        <div class="sub muted small">
          ${doneByTxt ? `Erledigt von: ${esc(doneByTxt)}` : ""}
          ${t.finalOk ? ` · 🧾 Endkontrolle: ${esc(t.finalBy||"")}` : ""}
          ${t.pointsAwarded ? ` · ⭐ Punkte gebucht` : ``}
        </div>
      </div>
      <div class="actions">
        ${t.status==="✅"
          ? (isAdmin ? `<button class="btn ghost" data-reset="1">↩️</button>` : ``)
          : `<button class="btn ghost" data-done="1">✅</button>`
        }
        ${isAdmin ? `
          <button class="btn ghost" data-final="1">🧾</button>
          <button class="btn ghost" data-edit="1">✏️</button>
          <button class="btn danger" data-del="1">🗑️</button>
        ` : ``}
      </div>
    `;

    // done
    const doneBtn = div.querySelector('[data-done="1"]');
    if(doneBtn){
      doneBtn.onclick = async ()=>{
        const def = meName || n(localStorage.getItem("meName"));
        const picked = askMultiNames_(def);
        if(picked == null) return;
        if(!picked.length){ await alertSafe_("Keine Namen."); return; }

        await updateDoc(doc(db,"daily_tasks",t.id), {
          status:"✅",
          doneBy: picked,
          doneAtLast: stamp(),
          updatedAt: serverTimestamp()
        });
      };
    }

    // reset (admin)
    const resetBtn = div.querySelector('[data-reset="1"]');
    if(resetBtn){
      resetBtn.onclick = async ()=>{
        if(!isAdmin) return;
        if(!confirm("Aufgabe zurücksetzen?")) return;
        await updateDoc(doc(db,"daily_tasks",t.id), {
          status:"❌",
          doneBy: [],
          doneAtLast: "",
          finalOk: false,
          finalBy: "",
          pointsAwarded: false,
          updatedAt: serverTimestamp()
        });
      };
    }

    if(isAdmin){
      // final toggle
      div.querySelector('[data-final="1"]').onclick = async ()=>{
        if((t.status||"")!=="✅"){ await alertSafe_("Endkontrolle nur bei ✅."); return; }
        await updateDoc(doc(db,"daily_tasks",t.id), {
          finalOk: !t.finalOk,
          finalBy: meName || "Admin",
          updatedAt: serverTimestamp()
        });
      };

      // edit task text
      div.querySelector('[data-edit="1"]').onclick = async ()=>{
        const nt = prompt("Aufgabe:", t.task || "");
        if(nt == null) return;
        await updateDoc(doc(db,"daily_tasks",t.id), { task:n(nt), updatedAt:serverTimestamp() });
      };

      // delete
      div.querySelector('[data-del="1"]').onclick = async ()=>{
        if(!confirm("Aufgabe löschen?")) return;
        await deleteDoc(doc(db,"daily_tasks",t.id));
      };
    }

    taskList.appendChild(div);
  });
}

/* ---------------- Ultra Dashboard ---------------- */
function renderGod_(){
  if(!isAdmin){
    if(godSummary) godSummary.textContent = "";
    if(godList) godList.innerHTML = "";
    return;
  }

  const qtxt = n(godSearch?.value).toLowerCase();
  const map = new Map();

  for(const t of allTasks){
    const tk = t.tagKey || "";
    if(!tk) continue;

    if(!map.has(tk)){
      map.set(tk, { tagKey:tk, tagId:t.tagId||tk, done:0, open:0, final:0, openTasks:[] });
    }
    const g = map.get(tk);

    if((t.status||"❌")==="✅") g.done++;
    else { g.open++; g.openTasks.push(t); }

    if(t.finalOk) g.final++;
    if(t.tagId) g.tagId = t.tagId;
  }

  let groups = [...map.values()].sort((a,b)=>(a.tagId||"").localeCompare(b.tagId||""));
  if(onlyOpen) groups = groups.filter(g=>g.open>0);
  if(qtxt){
    groups = groups.filter(g=>{
      const inTag = (g.tagId||"").toLowerCase().includes(qtxt);
      const inTask = g.openTasks.some(t=>String(t.task||"").toLowerCase().includes(qtxt));
      return inTag || inTask;
    });
  }

  let open=0, done=0, fin=0;
  for(const g of map.values()){ open+=g.open; done+=g.done; fin+=g.final; }
  if(godSummary) godSummary.textContent = `Tags: ${map.size} · Aufgaben: ${allTasks.length} · Offen: ${open} · Erledigt: ${done} · Endkontrolle: ${fin}`;

  if(!godList) return;
  godList.innerHTML = "";
  if(!groups.length){
    godList.innerHTML = `<div class="muted">Keine Treffer.</div>`;
    return;
  }

  for(const g of groups){
    const det = document.createElement("details");
    det.className = "detailsCard";
    det.open = g.open > 0;

    det.innerHTML = `
      <summary>
        <div class="row between">
          <div><b>🏷️ ${esc(g.tagId)}</b></div>
          <div class="row">
            <span class="pill">✅ ${g.done}</span>
            <span class="pill">⏳ ${g.open}</span>
            <span class="pill">🧾 ${g.final}</span>
          </div>
        </div>
      </summary>

      <div class="row">
        <button class="btn ghost" data-open="1">Öffnen</button>
        <button class="btn ghost" data-reset="1">Reset Tag</button>
        <button class="btn ghost" data-finalall="1">Final alle ✅</button>
        <button class="btn danger" data-delete="1">Tag löschen</button>
      </div>

      <div class="list" data-list="1"></div>
    `;

    det.querySelector('[data-open="1"]').onclick = ()=>openTag_(g.tagId);
    det.querySelector('[data-reset="1"]').onclick = ()=>bulkResetTag_(g.tagKey, g.tagId);
    det.querySelector('[data-finalall="1"]').onclick = ()=>bulkFinalAll_(g.tagKey, g.tagId);
    det.querySelector('[data-delete="1"]').onclick = ()=>deleteTagWithTasks_(g.tagKey, g.tagId);

    const list = det.querySelector('[data-list="1"]');

    if(!g.openTasks.length){
      list.innerHTML = `<div class="muted">Keine offenen Aufgaben.</div>`;
    }else{
      g.openTasks.slice(0,30).forEach(t=>{
        const it = document.createElement("div");
        it.className = "item";
        it.innerHTML = `
          <div class="main">
            <div class="title">⏳ ${esc(t.task||"")}</div>
            <div class="sub muted small">${Array.isArray(t.doneBy)&&t.doneBy.length?`Erledigt von: ${esc(t.doneBy.join(", "))}`:""}</div>
          </div>
          <div class="actions">
            <button class="btn ghost" data-done="1">✅</button>
            <button class="btn ghost" data-edit="1">✏️</button>
            <button class="btn danger" data-del="1">🗑️</button>
          </div>
        `;
        it.querySelector('[data-done="1"]').onclick = async ()=>{
          const picked = askMultiNames_(meName||"");
          if(picked == null) return;
          if(!picked.length){ await alertSafe_("Keine Namen."); return; }
          await updateDoc(doc(db,"daily_tasks",t.id), { status:"✅", doneBy:picked, doneAtLast:stamp(), updatedAt:serverTimestamp() });
        };
        it.querySelector('[data-edit="1"]').onclick = async ()=>{
          const nt = prompt("Aufgabe:", t.task || "");
          if(nt==null) return;
          await updateDoc(doc(db,"daily_tasks",t.id), { task:n(nt), updatedAt:serverTimestamp() });
        };
        it.querySelector('[data-del="1"]').onclick = async ()=>{
          if(!confirm("Aufgabe löschen?")) return;
          await deleteDoc(doc(db,"daily_tasks",t.id));
        };
        list.appendChild(it);
      });

      if(g.openTasks.length > 30){
        const more = document.createElement("div");
        more.className = "muted small";
        more.textContent = `… ${g.openTasks.length-30} weitere offene Aufgaben (Suche nutzen oder Tag öffnen).`;
        list.appendChild(more);
      }
    }

    godList.appendChild(det);
  }
}

async function bulkResetTag_(tagKeyStr, tagIdStr){
  if(!confirm(`Alle Aufgaben in "${tagIdStr}" zurücksetzen?`)) return;
  const snap = await getDocs(query(collection(db,"daily_tasks"), where("tagKey","==",tagKeyStr)));
  for(const d of snap.docs){
    await updateDoc(d.ref, { status:"❌", doneBy:[], doneAtLast:"", finalOk:false, finalBy:"", pointsAwarded:false, updatedAt:serverTimestamp() });
  }
  await alertSafe_("Reset ✓");
}

async function bulkFinalAll_(tagKeyStr, tagIdStr){
  if(!confirm(`Endkontrolle für alle ✅ in "${tagIdStr}" setzen?`)) return;
  const snap = await getDocs(query(collection(db,"daily_tasks"), where("tagKey","==",tagKeyStr)));
  for(const d of snap.docs){
    const t = d.data();
    if((t.status||"") === "✅" && !t.finalOk){
      await updateDoc(d.ref, { finalOk:true, finalBy:meName||"Admin", updatedAt:serverTimestamp() });
    }
  }
  await alertSafe_("Endkontrolle ✓ (Punkte werden serverseitig gebucht)");
}

async function deleteTagWithTasks_(tagKeyStr, tagIdStr){
  if(!confirm(`Tag "${tagIdStr}" + ALLE Tasks löschen?`)) return;

  const batch = writeBatch(db);
  const tasks = await getDocs(query(collection(db,"daily_tasks"), where("tagKey","==",tagKeyStr)));
  tasks.docs.forEach(d=>batch.delete(d.ref));
  batch.delete(doc(db,"tags",tagKeyStr));
  await batch.commit();

  await alertSafe_(`Gelöscht ✓ (Tasks: ${tasks.size})`);
}

/* ---------------- manual day change (fallback) ---------------- */
async function runDayChangeManual_(){
  // archives today under its dayKey (manual fallback)
  const d = dayKey(0);

  const tasks = await getDocs(query(collection(db,"daily_tasks")));
  for(const docu of tasks.docs){
    await setDoc(doc(db,"archives",d,"tasks",docu.id), { ...docu.data(), dayKey:d, archivedAt:serverTimestamp() }, { merge:true });
  }

  // delete daily_tasks
  await deleteDocsInBatches_(tasks.docs.map(x=>x.ref));

  await alertSafe_(`Manuell archiviert ✓ (Tasks: ${tasks.size})\nAuto läuft täglich 00:00.`);
}

async function deleteDocsInBatches_(refs){
  const chunk = 350;
  for(let i=0;i<refs.length;i+=chunk){
    const b = writeBatch(db);
    refs.slice(i,i+chunk).forEach(r=>b.delete(r));
    await b.commit();
  }
}

/* ---------------- Admin lists render + remove ---------------- */
function renderAdmins_(rows){
  if(!adminUidList) return;
  adminUidList.innerHTML = "";

  if(!rows.length){
    adminUidList.innerHTML = `<div class="muted">Keine Admins.</div>`;
    return;
  }

  rows.forEach(r=>{
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="main">
        <div class="title">ADMIN UID: ${esc(r.id)}</div>
        <div class="sub muted small">enabled: ${String(r.enabled !== false)}</div>
      </div>
      <div class="actions">
        <button class="btn danger">Entfernen</button>
      </div>
    `;
    div.querySelector("button").onclick = async ()=>{
      if(!isSuperAdmin){ await alertSafe_("Nur Super-Admin."); return; }
      if(!confirm("Admin entfernen?")) return;
      await deleteDoc(doc(db,"admins",r.id));
      await incCount_("adminCount", -1);
    };
    adminUidList.appendChild(div);
  });
}

function renderSuperAdmins_(rows){
  if(!superUidList) return;
  superUidList.innerHTML = "";

  if(!rows.length){
    superUidList.innerHTML = `<div class="muted">Keine Super-Admins?</div>`;
    return;
  }

  rows.forEach(r=>{
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="main">
        <div class="title">SUPERADMIN UID: ${esc(r.id)}</div>
        <div class="sub muted small">enabled: ${String(r.enabled === true)}</div>
      </div>
      <div class="actions">
        <button class="btn danger">Entfernen</button>
      </div>
    `;
    div.querySelector("button").onclick = async ()=>{
      if(!isSuperAdmin){ await alertSafe_("Nur Super-Admin."); return; }

      const counts = await getCounts_();
      if((counts.superCount||0) <= 1){
        await alertSafe_("Mindestens 1 Super-Admin muss bleiben.");
        return;
      }

      if(!confirm("Super-Admin entfernen?")) return;
      await deleteDoc(doc(db,"superadmins",r.id));
      await incCount_("superCount", -1);
    };
    superUidList.appendChild(div);
  });
}

function renderWeekly_(){
  if(!weeklyList) return;
  if(!isAdmin){ weeklyList.innerHTML=""; return; }

  weeklyList.innerHTML = "";
  if(!weeklyTemplates.length){
    weeklyList.innerHTML = `<div class="muted">Keine Wochenaufgaben.</div>`;
    return;
  }

  const names = {1:"Mo",2:"Di",3:"Mi",4:"Do",5:"Fr",6:"Sa"};
  weeklyTemplates.forEach(w=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">${names[w.weekday] || w.weekday} · 🏷️ ${esc(w.tagId||"")} · ${esc(w.task||"")}</div>
        <div class="sub muted small">${esc(w.id)}</div>
      </div>
      <div class="actions">
        <button class="btn danger">🗑️</button>
      </div>
    `;
    div.querySelector("button").onclick = async ()=>{
      if(!confirm("Wochenaufgabe löschen?")) return;
      await deleteDoc(doc(db,"weekly_templates",w.id));
    };
    weeklyList.appendChild(div);
  });
}

/* ---------------- streams ---------------- */
let employeesPointsMap = new Map();

function clearUnsubs_(){
  unsub.forEach(fn=>{ try{ fn(); }catch(e){} });
  unsub = [];
}

async function startStreams_(){
  clearUnsubs_();

  // prefs (vacation mute)
  unsub.push(onSnapshot(doc(db,"user_prefs",auth.currentUser.uid), (snap)=>{
    const d = snap.exists() ? (snap.data()||{}) : {};
    const ts = d.muteUntil;
    muteUntil = ts?.toDate ? ts.toDate() : null;
    vacClearBtn && vacClearBtn.classList.toggle("hidden", !(muteUntil && muteUntil.getTime()>Date.now()));
    refreshRole_();
  }));

  // employees
  unsub.push(onSnapshot(query(collection(db,"employees_public"), orderBy("name")),
    (snap)=>{
      employees = snap.docs.map(d=>n(d.data().name)).filter(Boolean);
      employeesPointsMap = new Map();
      snap.docs.forEach(d=>{
        const data = d.data()||{};
        employeesPointsMap.set(d.id, Number(data.points||0));
      });

      renderEmployeeSelectors_();
      if(isAdmin){
        renderEmployeesAdmin_();
        renderPoints_();
      }
    }
  ));

  // tags
  unsub.push(onSnapshot(query(collection(db,"tags"), orderBy("tagId")),
    (snap)=>{
      tags = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderTags_();
      renderAdminTags_();
    }
  ));

  // tasks global (dashboard)
  unsub.push(onSnapshot(query(collection(db,"daily_tasks"), orderBy("tagKey"), orderBy("task")),
    (snap)=>{
      allTasks = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderGod_();
      // update open tag list if same
      if(currentTagKey){
        const local = allTasks.filter(t=>t.tagKey===currentTagKey).sort((a,b)=>String(a.task||"").localeCompare(String(b.task||"")));
        renderTasks_(local);
      }
    }
  ));

  // admins (admin page list)
  unsub.push(onSnapshot(query(collection(db,"admins"), orderBy("addedAt")),
    (snap)=>{
      if(!isAdmin){ adminUidList && (adminUidList.innerHTML=""); return; }
      renderAdmins_(snap.docs.map(d=>({ id:d.id, ...d.data() })));
    }
  ));

  // superadmins
  unsub.push(onSnapshot(query(collection(db,"superadmins"), orderBy("addedAt")),
    (snap)=>{
      if(!isAdmin){ superUidList && (superUidList.innerHTML=""); return; }
      renderSuperAdmins_(snap.docs.map(d=>({ id:d.id, ...d.data() })));
    }
  ));

  // weekly templates
  unsub.push(onSnapshot(query(collection(db,"weekly_templates"), orderBy("weekday"), orderBy("order")),
    (snap)=>{
      weeklyTemplates = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderWeekly_();
    }
  ));

  tagSearch && (tagSearch.oninput = ()=>renderTags_());
  godSearch && (godSearch.oninput = ()=>renderGod_());
}

/* ---------------- init ---------------- */
onAuthStateChanged(auth, async ()=>{
  await ensureAnon_();

  // 1) Erst Bootstrap Superadmin (falls noch keiner existiert)
  await bootstrapSuperAdminOnce_();

  // 2) Danach counts doc (jetzt hast du Rechte)
  await ensureCountsDoc_();

  // 3) Seed employee
  await seedFirstEmployeeIfEmpty_();

  const stored = n(localStorage.getItem("meName"));
  if(stored) meName = stored;

  await refreshRole_();
  await startStreams_();

  if(meName){
    enterApp_();
  } else {
    show(loginView,true);
    show(appView,false);
  }
});

