import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, serverTimestamp, getDocs,
  writeBatch, limit, increment
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================================================
   Aufgabenliste ZDL RA 93 — ULTRA PRO (iPad/Android/Browser)
   - Name + Passwort Login (Passwort beim ersten Login setzen)
   - Anonymous Auth (für Firestore Zugriff)
   - Wochenplan Mo–Sa + Tages-Zusatzaufgaben
   - Auto Tageswechsel um 00:00 (wenn App offen)
   - Tags & Aufgaben, Multi-Select "wer erledigt"
   - ✅ Aufgaben für normale User unsichtbar
   - Punkte: taskPoints (erst bei Endkontrolle), ridePoints (pro Fahrt sofort)
   - Fahrten 72h sichtbar + Admin-Cleanup
   - Admin/Superadmin Verwaltung (3/8 Limits)
   - Urlaubsmodus bis Datum (stumm)
   ========================================================= */

/* ---------------- Firebase config (fixed) ---------------- */
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

/* ---------------- constants ---------------- */
const MAX_SUPER = 3;
const MAX_ADMIN = 8;

const META_COUNTS_REF = doc(db, "meta", "admin_counts");
const META_DAY_REF = (dayKey) => doc(db, "meta_days", dayKey); // marker: daily built or archived

/* ---------------- helpers ---------------- */
// =====================
// DAY KEY HELPER
// =====================

function dayKey() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
}

// Alias falls Code todayKeyNow benutzt
function todayKeyNow() {
  return dayKey();
}

// Alias / Fix: falls irgendwo todayKeyNow() benutzt wird
function todayKeyNow(){ return dayKey(); }
const $ = (id) => document.getElementById(id);
const show = (el, on) => { if (el) el.classList.toggle("hidden", !on); };
const n = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const esc = (s) => String(s ?? "")
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
const key = (s) => n(s).toLowerCase()
  .replace(/["'„“”]/g,"")
  .replace(/[^a-z0-9äöüß]/g,"");
const pad2 = (x) => String(x).padStart(2,"0");
const stamp = () => {
  const d=new Date();
  return `${pad2(d.getDate())}.${pad2(d.getMonth()+1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};
const dayKeyNow = () => {
  const d=new Date();
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
};
// Mo=1..So=0 (für Sonntag frei)
const weekdayNow = () => {
  const js = new Date().getDay(); // So=0
  if(js === 0) return 0;
  return js; // Mo=1..Sa=6
};
const uniq = (arr) => Array.from(new Set((arr||[]).map(x=>n(x)).filter(Boolean)));

/* ---------------- crypto: password hashing ---------------- */
function randSaltBase64_(len=16){
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  let bin = "";
  a.forEach(b=>bin += String.fromCharCode(b));
  return btoa(bin);
}
async function pbkdf2Hash_(password, saltBase64){
  const enc = new TextEncoder();
  const salt = Uint8Array.from(atob(saltBase64), c => c.charCodeAt(0));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const bytes = new Uint8Array(bits);
  let bin = "";
  bytes.forEach(b=>bin += String.fromCharCode(b));
  return btoa(bin);
}

/* ---------------- DOM ---------------- */
const loginView = $("loginView");
const appView = $("appView");
const whoami = $("whoami");
const reloadBtn = $("reloadBtn");
const logoutBtn = $("logoutBtn");

const nameSel = $("nameSel");
const passInput = $("passInput");
const loginBtn = $("loginBtn");
const loginErr = $("loginErr");
const showUidBtn = $("showUidBtn");
const copyUidBtn = $("copyUidBtn");
const uidBox = $("uidBox");

const tabTasks = $("tabTasks");
const tabRides = $("tabRides");
const tabAdmin = $("tabAdmin");
const tabSettings = $("tabSettings");

const viewTasks = $("viewTasks");
const viewRides = $("viewRides");
const viewAdmin = $("viewAdmin");
const viewSettings = $("viewSettings");

const dayKeyBadge = $("dayKeyBadge");
const weekdayBadge = $("weekdayBadge");

const tagSearch = $("tagSearch");
const tagList = $("tagList");

const openTagTitle = $("openTagTitle");
const tagMeta = $("tagMeta");
const closeTagBtn = $("closeTagBtn");
const addTodayTaskBtn = $("addTodayTaskBtn");
const newTaskBtn = $("newTaskBtn");
const taskList = $("taskList");

const rideNameSel = $("rideNameSel");
const rideEinsatz = $("rideEinsatz");
const addRideBtn = $("addRideBtn");
const rideInfo = $("rideInfo");
const ridesList = $("ridesList");

const adminBadge = $("adminBadge");
const adminLock = $("adminLock");
const adminArea = $("adminArea");

// Admin sub-tabs
const admTabEmployees = $("admTabEmployees");
const admTabPlan = $("admTabPlan");
const admTabTools = $("admTabTools");
const admTabTags = $("admTabTags");
const admTabRoles = $("admTabRoles");
const admTabPoints = $("admTabPoints");

const admEmployees = $("admEmployees");
const admPlan = $("admPlan");
const admTools = $("admTools");
const admTags = $("admTags");
const admRoles = $("admRoles");
const admPoints = $("admPoints");

// Admin controls
const empAdd = $("empAdd");
const empAddBtn = $("empAddBtn");
const empList = $("empList");

const planWeekday = $("planWeekday");
const planTagId = $("planTagId");
const planOrder = $("planOrder");
const planTask = $("planTask");
const planAddBtn = $("planAddBtn");
const planList = $("planList");

const forceDailyBuildBtn = $("forceDailyBuildBtn");
const dayChangeBtn = $("dayChangeBtn");

const tagAdd = $("tagAdd");
const tagAddBtn = $("tagAddBtn");
const adminTagList = $("adminTagList");

const adminUidAdd = $("adminUidAdd");
const adminUidAddBtn = $("adminUidAddBtn");
const adminUidList = $("adminUidList");

const superUidAdd = $("superUidAdd");
const superUidAddBtn = $("superUidAddBtn");
const superUidList = $("superUidList");

const pointsList = $("pointsList");

// Settings
const vacUntil = $("vacUntil");
const vacSaveBtn = $("vacSaveBtn");
const vacClearBtn = $("vacClearBtn");

/* ---------------- state ---------------- */
let meName = "";
let isAdmin = false;
let isSuperAdmin = false;

let employees = [];         // ["Anna", ...]
let tags = [];              // [{id, tagId, tagKey}, ...]
let weeklyTasks = [];       // plan entries
let dailyTasks = [];        // today tasks
let rides72h = [];          // rides visible

let currentTagId = "";      // selected tag (optional)
let currentTagKey = "";

let todayKey = dayKeyNow();
let todayWeekday = weekdayNow();

let vacationUntilStr = "";  // "YYYY-MM-DD" or ""

let unsubEmployees=null, unsubTags=null, unsubWeekly=null, unsubDaily=null, unsubRides=null;
let unsubAdmins=null, unsubSupers=null, unsubPoints=null;

/* ---------------- service worker ---------------- */
(async ()=>{
  try{
    if("serviceWorker" in navigator){
      await navigator.serviceWorker.register("./sw.js", { scope:"./" });
    }
  }catch(e){}
})();

/* ---------------- auth helpers ---------------- */
async function ensureAnon_(){
  if(auth.currentUser) return;
  await signInAnonymously(auth);
}
function alertSafe_(msg){ try{ alert(msg); }catch{} }

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
  await setDoc(META_COUNTS_REF, { [field]: next, updatedAt:serverTimestamp(), updatedBy:auth.currentUser.uid }, { merge:true });
}

/* ---------------- bootstrap: first superadmin ---------------- */
async function bootstrapSuperAdminOnce_(){
  // only do this once if none exists
  const q1 = query(collection(db,"superadmins"), where("enabled","==",true), limit(1));
  const snap = await getDocs(q1);
  if(!snap.empty) return;

  await ensureCountsDoc_();
  await setDoc(doc(db,"superadmins",auth.currentUser.uid), {
    enabled:true, addedAt:serverTimestamp(), addedBy:"BOOTSTRAP"
  }, { merge:true });

  const counts = await getCounts_();
  if((counts.superCount||0) < 1){
    await setDoc(META_COUNTS_REF, { superCount:1, adminCount:counts.adminCount||0, updatedAt:serverTimestamp() }, { merge:true });
  }
}

/* ---------------- seed first employee: Patrick ---------------- */
async function seedFirstEmployeeIfEmpty_(){
  const snap = await getDocs(query(collection(db,"employees_public"), limit(1)));
  if(!snap.empty) return;

  const firstName = "Patrick";
  await setDoc(doc(db,"employees_public", key(firstName)), {
    name:firstName, passSet:false,
    createdAt:serverTimestamp(), updatedAt:serverTimestamp(),
    seeded:true
  }, { merge:true });
}

/* ---------------- roles ---------------- */
async function refreshRole_(){
  const uid = auth.currentUser.uid;

  const sdoc = await getDoc(doc(db,"superadmins",uid));
  isSuperAdmin = sdoc.exists() && sdoc.data()?.enabled === true;

  const adoc = await getDoc(doc(db,"admins",uid));
  isAdmin = isSuperAdmin || (adoc.exists() && adoc.data()?.enabled === true);

  const label = `${meName || "—"}${isSuperAdmin ? " · SUPERADMIN" : (isAdmin ? " · ADMIN" : "")}`;
  if(whoami) whoami.textContent = label;

  if(tabAdmin) show(tabAdmin, isAdmin);
  if(adminBadge) adminBadge.classList.toggle("hidden", !isAdmin);
  show(adminLock, !isAdmin);
  show(adminArea, isAdmin);

  if(adminUidAddBtn) adminUidAddBtn.disabled = !isSuperAdmin;
  if(superUidAddBtn) superUidAddBtn.disabled = !isSuperAdmin;

  // admin-only task add buttons
  show(addTodayTaskBtn, isAdmin);
  show(newTaskBtn, isAdmin);
}

/* ---------------- vacation mode ---------------- */
function vacationActive_(){
  if(!vacationUntilStr) return false;
  const until = new Date(vacationUntilStr + "T23:59:59");
  return (new Date()) <= until;
}
async function loadVacation_(){
  // store per device in localStorage (no email login). optional: also in users doc
  vacationUntilStr = n(localStorage.getItem("vacUntil"));
  if(vacUntil) vacUntil.value = vacationUntilStr || "";
}
async function saveVacation_(val){
  vacationUntilStr = val || "";
  localStorage.setItem("vacUntil", vacationUntilStr);
  if(vacUntil) vacUntil.value = vacationUntilStr || "";
}

/* ---------------- login with password ---------------- */
async function loginWithPassword_(name, password){
  const id = key(name);
  const ref = doc(db,"employees_public", id);
  const snap = await getDoc(ref);
  if(!snap.exists()) throw new Error("Mitarbeiter existiert nicht (Admin muss ihn anlegen).");

  const d = snap.data() || {};
  if(!d.passSet){
    if(password.length < 4) throw new Error("Passwort zu kurz (mind. 4 Zeichen).");
    const salt = randSaltBase64_();
    const hash = await pbkdf2Hash_(password, salt);
    await updateDoc(ref, { passSalt:salt, passHash:hash, passSet:true, updatedAt:serverTimestamp() });
    return true;
  } else {
    const hash = await pbkdf2Hash_(password, d.passSalt);
    if(hash !== d.passHash) throw new Error("Passwort falsch.");
    return true;
  }
}

/* ---------------- navigation ---------------- */
function setView_(name){
  const map = { tasks:viewTasks, rides:viewRides, admin:viewAdmin, settings:viewSettings };
  for(const k of Object.keys(map)) show(map[k], k===name);

  const tabs = { tasks:tabTasks, rides:tabRides, admin:tabAdmin, settings:tabSettings };
  for(const k of Object.keys(tabs)){
    if(!tabs[k]) continue;
    tabs[k].classList.toggle("active", k===name);
  }
}

/* ---------------- UI: Multi select dialog ---------------- */
async function pickEmployeesDialog_(title, preselected=[]){
  // Simple modal-like dialog created dynamically
  const sel = new Set((preselected||[]).map(n));
  const wrap = document.createElement("div");
  wrap.style.position="fixed";
  wrap.style.inset="0";
  wrap.style.background="rgba(0,0,0,.55)";
  wrap.style.display="flex";
  wrap.style.alignItems="center";
  wrap.style.justifyContent="center";
  wrap.style.padding="14px";
  wrap.style.zIndex="9999";

  const box = document.createElement("div");
  box.style.width="min(520px, 100%)";
  box.style.maxHeight="80vh";
  box.style.overflow="auto";
  box.style.background="#121826";
  box.style.border="1px solid #263244";
  box.style.borderRadius="14px";
  box.style.padding="12px";
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
      <div style="font-weight:900">${esc(title)}</div>
      <button class="btn ghost" data-x="1">✕</button>
    </div>
    <div class="divider"></div>
    <div class="muted small">Wähle die Mitarbeiter, die diese Aufgabe erledigt haben.</div>
    <div style="margin-top:10px" data-list="1"></div>
    <div class="divider"></div>
    <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap">
      <button class="btn ghost" data-cancel="1">Abbrechen</button>
      <button class="btn" data-ok="1">OK</button>
    </div>
  `;

  const list = box.querySelector('[data-list="1"]');

  employees.forEach(name=>{
    const id = "chk_"+key(name)+"_"+Math.random().toString(16).slice(2);
    const row = document.createElement("label");
    row.style.display="flex";
    row.style.flexDirection="row";
    row.style.alignItems="center";
    row.style.gap="10px";
    row.style.padding="8px 0";
    row.innerHTML = `
      <input type="checkbox" id="${id}" ${sel.has(name) ? "checked":""} />
      <span style="color:#e6edf3;font-weight:700">${esc(name)}</span>
    `;
    const chk = row.querySelector("input");
    chk.onchange = () => {
      if(chk.checked) sel.add(name);
      else sel.delete(name);
    };
    list.appendChild(row);
  });

  return await new Promise((resolve)=>{
    function close(res){
      wrap.remove();
      resolve(res);
    }
    box.querySelector('[data-x="1"]').onclick = ()=>close(null);
    box.querySelector('[data-cancel="1"]').onclick = ()=>close(null);
    box.querySelector('[data-ok="1"]').onclick = ()=>{
      const arr = Array.from(sel).map(n).filter(Boolean);
      if(arr.length < 1){ alertSafe_("Bitte mindestens 1 Person auswählen."); return; }
      close(arr);
    };
    wrap.appendChild(box);
    document.body.appendChild(wrap);
  });
}

/* ---------------- daily tasks build ---------------- */
async function ensureDailyTasksForToday_(force=false){
  todayKey = dayKeyNow();
  todayWeekday = weekdayNow();

  if(dayKeyBadge) dayKeyBadge.textContent = todayKey;
  if(weekdayBadge){
    weekdayBadge.textContent = todayWeekday === 0 ? "Sonntag (frei)" : `Wochentag: ${todayWeekday}`;
  }

  // Sonntag: keine Tagesliste bauen
  if(todayWeekday === 0) return;

  const markerRef = META_DAY_REF(todayKey);
  const markerSnap = await getDoc(markerRef);

  if(markerSnap.exists() && markerSnap.data()?.built === true && !force){
    return;
  }

  // build from weekly_tasks where weekday == todayWeekday AND active != false
  const planSnap = await getDocs(query(
    collection(db,"weekly_tasks"),
    where("weekday","==",todayWeekday),
    orderBy("order")
  ));

  const batch = writeBatch(db);
  let created = 0;

  for(const d of planSnap.docs){
    const t = d.data() || {};
    if(t.active === false) continue;

    const tagId = n(t.tagId);
    const task = n(t.task);
    if(!tagId || !task) continue;

    const tk = key(tagId);

    // ensure tag exists
    batch.set(doc(db,"tags", tk), { tagId, tagKey:tk, updatedAt:serverTimestamp() }, { merge:true });

    // create daily task doc
    const ref = doc(collection(db,"daily_tasks"));
    batch.set(ref, {
      dayKey: todayKey,
      weekday: todayWeekday,
      tagId,
      tagKey: tk,
      task,
      status:"❌",
      doneBy: [],
      doneAtLast:"",
      finalOk:false,
      finalBy:"",
      pointsBooked:false,
      pointsBookedFor:[],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      source: "weekly_tasks",
      weeklyRef: d.id,
      order: Number(t.order||10)
    }, { merge:false });

    created++;
  }

  batch.set(markerRef, {
    built:true, builtAt:serverTimestamp(), builtBy:auth.currentUser.uid, weekday:todayWeekday, createdCount:created
  }, { merge:true });

  await batch.commit();
}

/* ---------------- day change (archive + rebuild) ---------------- */
async function runDayChange_(forceDayKey=null){
  const oldDayKey = forceDayKey || todayKey;

  // archive daily tasks of old day
  const snap = await getDocs(query(collection(db,"daily_tasks"), where("dayKey","==",oldDayKey)));
  const batch = writeBatch(db);

  for(const d of snap.docs){
    batch.set(doc(db, "archives", oldDayKey, "tasks", d.id), {
      ...d.data(),
      archivedAt:serverTimestamp(),
      archivedBy:auth.currentUser.uid
    }, { merge:true });
    batch.delete(d.ref);
  }

  batch.set(doc(db,"meta_days", oldDayKey), { archived:true, archivedAt:serverTimestamp() }, { merge:true });

  await batch.commit();

  // rebuild new day
  await ensureDailyTasksForToday_(true);
}

/* ---------------- rides: add + list + cleanup ---------------- */
function nowMs_(){ return Date.now(); }
function hoursMs_(h){ return h*60*60*1000; }
function within72h_(ts){
  // ts can be Firestore Timestamp (has toMillis)
  const ms = ts?.toMillis ? ts.toMillis() : 0;
  return ms >= (nowMs_() - hoursMs_(72));
}

async function addRide_(){
  const nm = n(rideNameSel?.value) || meName;
  const eins = n(rideEinsatz?.value);
  if(!nm) return alertSafe_("Name fehlt.");
  if(!eins) return alertSafe_("Einsatznummer fehlt.");

  const dayKey = dayKeyNow();
  const rideRef = doc(collection(db,"rides"));
  const pointsRef = doc(db,"points", key(nm));

  const batch = writeBatch(db);
  batch.set(rideRef, {
    name:nm,
    nameKey:key(nm),
    einsatz:eins,
    dayKey,
    at: serverTimestamp(),
    createdAt: serverTimestamp()
  });

  // ridePoints sofort buchen
  batch.set(pointsRef, {
    name:nm,
    ridePoints: increment(1),
    updatedAt: serverTimestamp()
  }, { merge:true });

  await batch.commit();

  if(rideEinsatz) rideEinsatz.value="";
  if(rideInfo) rideInfo.textContent="Gespeichert ✓";
  setTimeout(()=>{ if(rideInfo) rideInfo.textContent=""; }, 1200);
}

async function cleanupRides72hIfAdmin_(){
  if(!isAdmin) return;

  // fetch latest rides, delete those older than 72h
  const snap = await getDocs(query(collection(db,"rides"), orderBy("at","desc"), limit(250)));
  const old = [];
  for(const d of snap.docs){
    const data = d.data() || {};
    if(data.at && data.at.toMillis && !within72h_(data.at)){
      old.push(d.ref);
    }
  }
  if(!old.length) return;

  const chunk = 350;
  for(let i=0;i<old.length;i+=chunk){
    const b = writeBatch(db);
    old.slice(i,i+chunk).forEach(r=>b.delete(r));
    await b.commit();
  }
}

/* ---------------- points (2 accounts) ---------------- */
async function bookTaskPoints_(names, delta){
  // delta = +1 or -1 per person
  const b = writeBatch(db);
  for(const nm of names){
    const ref = doc(db,"points", key(nm));
    b.set(ref, {
      name:nm,
      taskPoints: increment(delta),
      updatedAt: serverTimestamp()
    }, { merge:true });
  }
  await b.commit();
}

/* ---------------- render ---------------- */
function renderEmployeeSelectors_(){
  const opts = [`<option value="">Name wählen…</option>`]
    .concat(employees.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`))
    .join("");

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
  if(!employees.length){
    empList.innerHTML = `<div class="muted">Keine Mitarbeiter.</div>`;
    return;
  }

  employees.forEach(name=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">${esc(name)}</div>
        <div class="sub muted small">Doc: employees_public/${esc(key(name))}</div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-reset="1">Passwort löschen</button>
        <button class="btn danger" data-del="1">🗑️</button>
      </div>
    `;

    div.querySelector('[data-reset="1"]').onclick = async ()=>{
      if(!isAdmin) return;
      if(!confirm(`Passwort von "${name}" löschen?\nBeim nächsten Login wird es neu gesetzt.`)) return;
      await updateDoc(doc(db,"employees_public", key(name)), {
        passSet:false, passHash:"", passSalt:"", updatedAt:serverTimestamp()
      });
      alertSafe_("Passwort zurückgesetzt ✓");
    };

    div.querySelector('[data-del="1"]').onclick = async ()=>{
      if(!isAdmin) return;
      if(!confirm(`"${name}" löschen?`)) return;
      await deleteDoc(doc(db,"employees_public", key(name)));
    };

    empList.appendChild(div);
  });
}

function renderTags_(){
  if(!tagList) return;
  const qtxt = n(tagSearch?.value).toLowerCase();
  const list = tags.filter(t=>{
    const tid = String(t.tagId||t.id||"").toLowerCase();
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
  adminTagList.innerHTML = "";
  if(!tags.length){
    adminTagList.innerHTML = `<div class="muted">Keine Tags.</div>`;
    return;
  }

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
    div.querySelector('[data-del="1"]').onclick = async ()=>{
      if(!isAdmin) return;
      if(!confirm(`Tag "${tid}" löschen? (Tasks bleiben im Archiv/TagKey)`)) return;
      await deleteDoc(doc(db,"tags", t.id));
    };
    adminTagList.appendChild(div);
  });
}

function renderWeeklyPlan_(){
  if(!planList) return;
  planList.innerHTML = "";
  if(!weeklyTasks.length){
    planList.innerHTML = `<div class="muted">Keine Wochenplan-Aufgaben.</div>`;
    return;
  }

  weeklyTasks.forEach(t=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">W${t.weekday} · 🏷️ ${esc(t.tagId)} · ${esc(t.task)}</div>
        <div class="sub muted small">order=${esc(t.order)} · active=${t.active!==false}</div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-edit="1">✏️</button>
        <button class="btn danger" data-del="1">🗑️</button>
      </div>
    `;

    div.querySelector('[data-edit="1"]').onclick = async ()=>{
      if(!isAdmin) return;
      const nt = prompt("Aufgabe:", t.task||"");
      if(nt==null) return;
      const ntag = prompt("Tag_ID:", t.tagId||"");
      if(ntag==null) return;
      const norder = Number(prompt("Sortierung (order):", String(t.order||10))||t.order||10);
      await updateDoc(doc(db,"weekly_tasks", t.id), {
        task:n(nt), tagId:n(ntag), tagKey:key(ntag),
        order:norder, updatedAt:serverTimestamp()
      });
    };

    div.querySelector('[data-del="1"]').onclick = async ()=>{
      if(!isAdmin) return;
      if(!confirm("Wochenplan-Aufgabe löschen?")) return;
      await deleteDoc(doc(db,"weekly_tasks", t.id));
    };

    planList.appendChild(div);
  });
}

function renderRides_(){
  if(!ridesList) return;
  ridesList.innerHTML = "";
  if(!rides72h.length){
    ridesList.innerHTML = `<div class="muted">Keine Fahrten in den letzten 72h.</div>`;
    return;
  }

  rides72h.forEach(r=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">🚗 ${esc(r.name)} · Einsatz ${esc(r.einsatz)}</div>
        <div class="sub muted small">${esc(r.atText || "")} · dayKey ${esc(r.dayKey||"")}</div>
      </div>
      <div class="actions">
        ${isAdmin ? `<button class="btn danger" data-del="1">🗑️</button>` : ``}
      </div>
    `;
    const del = div.querySelector('[data-del="1"]');
    if(del){
      del.onclick = async ()=>{
        if(!confirm("Fahrt löschen? (Punkte bleiben)")) return;
        await deleteDoc(doc(db,"rides", r.id));
      };
    }
    ridesList.appendChild(div);
  });
}

function renderPoints_(rows){
  if(!pointsList) return;
  pointsList.innerHTML = "";
  if(!rows.length){
    pointsList.innerHTML = `<div class="muted">Noch keine Punkte.</div>`;
    return;
  }
  rows.sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  rows.forEach(p=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">${esc(p.name||p.id)}</div>
        <div class="sub muted small">
          Aufgabenpunkte: <b>${Number(p.taskPoints||0)}</b>
          · Fahrtenpunkte: <b>${Number(p.ridePoints||0)}</b>
        </div>
      </div>
      <div class="actions"></div>
    `;
    pointsList.appendChild(div);
  });
}

/* ---------------- tasks: open/close + render ---------------- */
function openTag_(tagId){
  currentTagId = n(tagId);
  currentTagKey = key(currentTagId);
  if(openTagTitle) openTagTitle.textContent = `Tag: ${currentTagId}`;
  if(tagMeta) tagMeta.textContent = `tagKey: ${currentTagKey}`;
  renderDailyTasks_();
}
function closeTag_(){
  currentTagId = "";
  currentTagKey = "";
  if(openTagTitle) openTagTitle.textContent = `Heute: Alle Aufgaben`;
  if(tagMeta) tagMeta.textContent = "";
  renderDailyTasks_();
}

function visibleForUser_(t){
  // normale User: ✅ unsichtbar
  if(isAdmin) return true;
  return (t.status||"❌") !== "✅";
}

function renderDailyTasks_(){
  if(!taskList) return;

  let list = dailyTasks.slice();

  // filter today only (already)
  if(currentTagKey){
    list = list.filter(t => (t.tagKey||"") === currentTagKey);
  }

  // normal user filter
  list = list.filter(visibleForUser_);

  // order: tagId then order then task
  list.sort((a,b)=>{
    const A = (a.tagId||"").localeCompare(b.tagId||"");
    if(A) return A;
    const O = (Number(a.order||10) - Number(b.order||10));
    if(O) return O;
    return String(a.task||"").localeCompare(String(b.task||""));
  });

  taskList.innerHTML = "";
  if(todayWeekday === 0){
    taskList.innerHTML = `<div class="muted">Sonntag ist frei. Keine Tagesaufgaben.</div>`;
    return;
  }
  if(!list.length){
    taskList.innerHTML = `<div class="muted">Keine Aufgaben.</div>`;
    return;
  }

  list.forEach(t=>{
    const doneByTxt = Array.isArray(t.doneBy) ? t.doneBy.join(", ") : "";
    const div = document.createElement("div");
    div.className="item";

    const statusIcon = (t.status==="✅") ? "✅" : "⏳";
    const finalIcon = t.finalOk ? "🧾✅" : "🧾⏳";

    div.innerHTML = `
      <div class="main">
        <div class="title">${statusIcon} ${esc(t.task||"")}</div>
        <div class="sub muted small">
          🏷️ ${esc(t.tagId||"")}
          ${doneByTxt ? ` · Erledigt von: ${esc(doneByTxt)}` : ""}
          ${t.doneAtLast ? ` · ${esc(t.doneAtLast)}` : ""}
          ${isAdmin ? ` · Endkontrolle: ${finalIcon} ${t.finalBy?`(${esc(t.finalBy)})`:""}` : ""}
          ${isAdmin && t.pointsBooked ? ` · Punkte gebucht ✓` : ""}
        </div>
      </div>
      <div class="actions">
        ${t.status!=="✅" ? `<button class="btn" data-done="1">✅ erledigt</button>` : ``}
        ${isAdmin ? `
          ${t.status==="✅" ? `<button class="btn ghost" data-reset="1">↩️ Reset</button>` : ``}
          <button class="btn ghost" data-final="1">🧾 Endkontrolle</button>
          <button class="btn ghost" data-edit="1">✏️</button>
          <button class="btn danger" data-del="1">🗑️</button>
        ` : ``}
      </div>
    `;

    const doneBtn = div.querySelector('[data-done="1"]');
    if(doneBtn){
      doneBtn.onclick = async ()=>{
        // normal user: can only do once (rules enforce)
        const selected = await pickEmployeesDialog_("Wer hat erledigt?", []);
        if(!selected) return;

        await updateDoc(doc(db,"daily_tasks", t.id), {
          status:"✅",
          doneBy: uniq(selected),
          doneAtLast: stamp(),
          updatedAt: serverTimestamp()
        });
      };
    }

    if(isAdmin){
      const resetBtn = div.querySelector('[data-reset="1"]');
      if(resetBtn){
        resetBtn.onclick = async ()=>{
          if(!confirm("Aufgabe zurücksetzen? (Punkte werden ggf. entbucht, wenn Endkontrolle aktiv war)")) return;

          // if points booked, unbook first
          if(t.pointsBooked && Array.isArray(t.pointsBookedFor) && t.pointsBookedFor.length){
            await bookTaskPoints_(t.pointsBookedFor, -1);
          }

          await updateDoc(doc(db,"daily_tasks", t.id), {
            status:"❌",
            doneBy: [],
            doneAtLast:"",
            finalOk:false,
            finalBy:"",
            pointsBooked:false,
            pointsBookedFor:[],
            updatedAt: serverTimestamp()
          });
        };
      }

      div.querySelector('[data-final="1"]').onclick = async ()=>{
        if(t.status!=="✅"){
          alertSafe_("Endkontrolle nur wenn Aufgabe ✅ ist.");
          return;
        }

        const next = !t.finalOk;

        // If turning ON finalOk: book points once
        if(next === true && !t.pointsBooked){
          const people = uniq(Array.isArray(t.doneBy)?t.doneBy:[]);
          if(!people.length){
            alertSafe_("Keine Personen bei doneBy.");
            return;
          }
          await bookTaskPoints_(people, +1);

          await updateDoc(doc(db,"daily_tasks", t.id), {
            finalOk:true,
            finalBy: meName || "Admin",
            pointsBooked:true,
            pointsBookedFor: people,
            updatedAt: serverTimestamp()
          });
          return;
        }

        // If turning OFF finalOk: unbook if booked
        if(next === false && t.pointsBooked){
          const people = uniq(Array.isArray(t.pointsBookedFor)?t.pointsBookedFor:[]);
          if(people.length) await bookTaskPoints_(people, -1);

          await updateDoc(doc(db,"daily_tasks", t.id), {
            finalOk:false,
            finalBy:"",
            pointsBooked:false,
            pointsBookedFor:[],
            updatedAt: serverTimestamp()
          });
          return;
        }

        // else just toggle
        await updateDoc(doc(db,"daily_tasks", t.id), {
          finalOk: next,
          finalBy: next ? (meName || "Admin") : "",
          updatedAt: serverTimestamp()
        });
      };

      div.querySelector('[data-edit="1"]').onclick = async ()=>{
        const nt = prompt("Aufgabe:", t.task || "");
        if(nt==null) return;
        const ntag = prompt("Tag_ID:", t.tagId || "");
        if(ntag==null) return;
        await updateDoc(doc(db,"daily_tasks", t.id), {
          task:n(nt),
          tagId:n(ntag),
          tagKey:key(ntag),
          updatedAt: serverTimestamp()
        });
      };

      div.querySelector('[data-del="1"]').onclick = async ()=>{
        if(!confirm("Aufgabe löschen?")) return;

        // if points booked, unbook
        if(t.pointsBooked && Array.isArray(t.pointsBookedFor) && t.pointsBookedFor.length){
          await bookTaskPoints_(t.pointsBookedFor, -1);
        }

        // archive delete (optional)
        await setDoc(doc(db,"archives", todayKey, "deleted_tasks", t.id), {
          ...t,
          deletedAt: serverTimestamp(),
          deletedBy: auth.currentUser.uid
        }, { merge:true });

        await deleteDoc(doc(db,"daily_tasks", t.id));
      };
    }

    taskList.appendChild(div);
  });
}

/* ---------------- Admin lists (roles) ---------------- */
function renderAdmins_(rows){
  if(!adminUidList) return;
  adminUidList.innerHTML = "";
  if(!rows.length){
    adminUidList.innerHTML = `<div class="muted">Keine Admins.</div>`;
    return;
  }
  rows.forEach(r=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">ADMIN UID: ${esc(r.id)}</div>
        <div class="sub muted small">enabled: ${String(r.enabled===true)}</div>
      </div>
      <div class="actions">
        <button class="btn danger">Entfernen</button>
      </div>
    `;
    div.querySelector("button").onclick = async ()=>{
      if(!isSuperAdmin) return alertSafe_("Nur Super-Admin.");
      if(!confirm("Admin entfernen?")) return;
      await deleteDoc(doc(db,"admins", r.id));
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
    div.className="item";
    div.innerHTML = `
      <div class="main">
        <div class="title">SUPERADMIN UID: ${esc(r.id)}</div>
        <div class="sub muted small">enabled: ${String(r.enabled===true)}</div>
      </div>
      <div class="actions">
        <button class="btn danger">Entfernen</button>
      </div>
    `;
    div.querySelector("button").onclick = async ()=>{
      if(!isSuperAdmin) return alertSafe_("Nur Super-Admin.");
      const counts = await getCounts_();
      if((counts.superCount||0) <= 1){
        alertSafe_("Mindestens 1 Super-Admin muss bleiben.");
        return;
      }
      if(!confirm("Super-Admin entfernen?")) return;
      await deleteDoc(doc(db,"superadmins", r.id));
      await incCount_("superCount", -1);
    };
    superUidList.appendChild(div);
  });
}

/* ---------------- streams ---------------- */
async function startStreams_(){
  // employees
  unsubEmployees && unsubEmployees();
  unsubEmployees = onSnapshot(
    query(collection(db,"employees_public"), orderBy("name")),
    (snap)=>{
      employees = snap.docs.map(d=>n(d.data().name)).filter(Boolean);
      renderEmployeeSelectors_();
      if(isAdmin) renderEmployeesAdmin_();
    }
  );

  // tags
  unsubTags && unsubTags();
  unsubTags = onSnapshot(
    query(collection(db,"tags"), orderBy("tagId")),
    (snap)=>{
      tags = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderTags_();
      if(isAdmin) renderAdminTags_();
    }
  );

  // weekly plan (admin)
  unsubWeekly && unsubWeekly();
  unsubWeekly = onSnapshot(
    query(collection(db,"weekly_tasks"), orderBy("weekday"), orderBy("order")),
    (snap)=>{
      weeklyTasks = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      if(isAdmin) renderWeeklyPlan_();
    }
  );

  // daily tasks for today
  unsubDaily && unsubDaily();
  unsubDaily = onSnapshot(
    query(collection(db,"daily_tasks"), where("dayKey","==",todayKey)),
    (snap)=>{
      dailyTasks = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderDailyTasks_();
    }
  );

  // rides
  unsubRides && unsubRides();
  unsubRides = onSnapshot(
    query(collection(db,"rides"), orderBy("at","desc"), limit(250)),
    (snap)=>{
      const rows = [];
      for(const d of snap.docs){
        const data = d.data() || {};
        // keep only within 72h
        if(data.at && data.at.toMillis && within72h_(data.at)){
          rows.push({
            id:d.id,
            ...data,
            atText: data.at ? new Date(data.at.toMillis()).toLocaleString() : ""
          });
        }
      }
      rides72h = rows;
      renderRides_();
    }
  );

  // admins (admin view)
  unsubAdmins && unsubAdmins();
  unsubAdmins = onSnapshot(
    query(collection(db,"admins"), orderBy("addedAt")),
    (snap)=>{
      if(!isAdmin){ if(adminUidList) adminUidList.innerHTML=""; return; }
      const rows = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderAdmins_(rows);
    }
  );

  // superadmins
  unsubSupers && unsubSupers();
  unsubSupers = onSnapshot(
    query(collection(db,"superadmins"), orderBy("addedAt")),
    (snap)=>{
      if(!isAdmin){ if(superUidList) superUidList.innerHTML=""; return; }
      const rows = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderSuperAdmins_(rows);
    }
  );

  // points (admin)
  unsubPoints && unsubPoints();
  unsubPoints = onSnapshot(
    query(collection(db,"points"), orderBy("name")),
    (snap)=>{
      if(!isAdmin){ if(pointsList) pointsList.innerHTML=""; return; }
      const rows = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderPoints_(rows);
    }
  );

  // inputs
  if(tagSearch) tagSearch.oninput = ()=>renderTags_();
}

/* ---------------- buttons ---------------- */
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
  alertSafe_("UID:\n" + uid);
});

copyUidBtn && (copyUidBtn.onclick = async () => {
  const uid = auth?.currentUser?.uid || "";
  if(!uid) return;
  try{ await navigator.clipboard.writeText(uid); alertSafe_("UID kopiert ✓"); }
  catch(e){ alertSafe_(uid); }
});

loginBtn && (loginBtn.onclick = async () => {
  loginErr && (loginErr.textContent = "");
  const nm = n(nameSel?.value);
  const pw = n(passInput?.value);

  if(!nm){ if(loginErr) loginErr.textContent = "Bitte Name wählen."; return; }
  if(!pw){ if(loginErr) loginErr.textContent = "Bitte Passwort eingeben."; return; }

  try{
    await ensureAnon_();
    await loginWithPassword_(nm, pw);

    meName = nm;
    localStorage.setItem("meName", nm);

    // optional: remember in users doc
    await setDoc(doc(db,"users",auth.currentUser.uid), { name:nm, updatedAt:serverTimestamp() }, { merge:true });

    await refreshRole_();
    enterApp_();
  }catch(err){
    if(loginErr) loginErr.textContent = String(err?.message || err);
  }
});

closeTagBtn && (closeTagBtn.onclick = ()=>closeTag_());

addTodayTaskBtn && (addTodayTaskBtn.onclick = async ()=>{
  if(!isAdmin) return;
  if(todayWeekday === 0) return alertSafe_("Sonntag: frei.");

  const t = prompt("Zusatzaufgabe (nur für heute):");
  if(!t) return;

  const tagId = prompt("Tag_ID (optional, leer = 'Allgemein'):", currentTagId || "");
  const tag = n(tagId) || "Allgemein";
  const tk = key(tag);

  // ensure tag exists
  await setDoc(doc(db,"tags", tk), { tagId:tag, tagKey:tk, updatedAt:serverTimestamp() }, { merge:true });

  await addDoc(collection(db,"daily_tasks"), {
    dayKey: todayKey,
    weekday: todayWeekday,
    tagId: tag,
    tagKey: tk,
    task: n(t),
    status:"❌",
    doneBy: [],
    doneAtLast:"",
    finalOk:false,
    finalBy:"",
    pointsBooked:false,
    pointsBookedFor:[],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    source:"extra_today",
    order: 999
  });
});

newTaskBtn && (newTaskBtn.onclick = async ()=>{
  if(!isAdmin) return;
  if(!currentTagKey) return alertSafe_("Bitte zuerst einen Tag öffnen (oder Zusatzaufgabe nutzen).");
  if(todayWeekday === 0) return alertSafe_("Sonntag: frei.");

  const t = prompt("Neue Aufgabe (für diesen Tag) :");
  if(!t) return;

  await addDoc(collection(db,"daily_tasks"), {
    dayKey: todayKey,
    weekday: todayWeekday,
    tagId: currentTagId,
    tagKey: currentTagKey,
    task: n(t),
    status:"❌",
    doneBy: [],
    doneAtLast:"",
    finalOk:false,
    finalBy:"",
    pointsBooked:false,
    pointsBookedFor:[],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    source:"admin_today",
    order: 500
  });
});

addRideBtn && (addRideBtn.onclick = async ()=>{
  try{
    if(vacationActive_()){
      if(!confirm("Urlaubsmodus ist aktiv. Fahrt trotzdem eintragen?")) return;
    }
    await addRide_();
  }catch(e){
    alertSafe_(String(e?.message||e));
  }
});

// Admin: add employee
empAddBtn && (empAddBtn.onclick = async ()=>{
  if(!isAdmin) return alertSafe_("Nur Admin.");
  const nm = n(empAdd?.value);
  if(!nm) return alertSafe_("Name fehlt.");
  await setDoc(doc(db,"employees_public", key(nm)), {
    name:nm, passSet:false, updatedAt:serverTimestamp(), createdAt:serverTimestamp()
  }, { merge:true });
  if(empAdd) empAdd.value="";
});

// Admin: add weekly plan entry
planAddBtn && (planAddBtn.onclick = async ()=>{
  if(!isAdmin) return alertSafe_("Nur Admin.");
  const w = Number(planWeekday?.value||0);
  const tagId = n(planTagId?.value);
  const task = n(planTask?.value);
  const order = Number(planOrder?.value||10);

  if(!w || w<1 || w>6) return alertSafe_("Wochentag 1..6 wählen.");
  if(!tagId) return alertSafe_("Tag_ID fehlt.");
  if(!task) return alertSafe_("Aufgabe fehlt.");

  const tk = key(tagId);

  await setDoc(doc(db,"tags", tk), { tagId, tagKey:tk, updatedAt:serverTimestamp() }, { merge:true });

  await addDoc(collection(db,"weekly_tasks"), {
    weekday:w,
    tagId,
    tagKey:tk,
    task,
    order,
    active:true,
    createdAt:serverTimestamp(),
    updatedAt:serverTimestamp()
  });

  if(planTask) planTask.value="";
});

// Admin: tools
forceDailyBuildBtn && (forceDailyBuildBtn.onclick = async ()=>{
  if(!isAdmin) return alertSafe_("Nur Admin.");
  if(!confirm("Heute neu aufbauen?\nAchtung: Es werden zusätzlich Aufgaben aus dem Wochenplan hinzugefügt (bestehende bleiben).")) return;
  await ensureDailyTasksForToday_(true);
});

dayChangeBtn && (dayChangeBtn.onclick = async ()=>{
  if(!isAdmin) return alertSafe_("Nur Admin.");
  if(!confirm("Tageswechsel jetzt?\nArchiviert heutige Tasks und baut neuen Tag auf.")) return;
  await runDayChange_(todayKey);
});

// Admin: tags
tagAddBtn && (tagAddBtn.onclick = async ()=>{
  if(!isAdmin) return alertSafe_("Nur Admin.");
  const tid = n(tagAdd?.value);
  if(!tid) return alertSafe_("Tag_ID fehlt.");
  await setDoc(doc(db,"tags", key(tid)), { tagId:tid, tagKey:key(tid), updatedAt:serverTimestamp() }, { merge:true });
  if(tagAdd) tagAdd.value="";
});

// Roles: add admin
adminUidAddBtn && (adminUidAddBtn.onclick = async ()=>{
  if(!isSuperAdmin) return alertSafe_("Nur Super-Admin.");
  const uid = n(adminUidAdd?.value);
  if(!uid) return alertSafe_("UID fehlt.");

  await ensureCountsDoc_();
  const counts = await getCounts_();
  if((counts.adminCount||0) >= MAX_ADMIN) return alertSafe_(`Maximal ${MAX_ADMIN} Admins erreicht.`);

  await setDoc(doc(db,"admins", uid), { enabled:true, addedAt:serverTimestamp(), addedBy:auth.currentUser.uid }, { merge:true });
  await incCount_("adminCount", +1);
  if(adminUidAdd) adminUidAdd.value="";
});

// Roles: add superadmin
superUidAddBtn && (superUidAddBtn.onclick = async ()=>{
  if(!isSuperAdmin) return alertSafe_("Nur Super-Admin.");
  const uid = n(superUidAdd?.value);
  if(!uid) return alertSafe_("UID fehlt.");

  await ensureCountsDoc_();
  const counts = await getCounts_();
  if((counts.superCount||0) >= MAX_SUPER) return alertSafe_(`Maximal ${MAX_SUPER} Super-Admins erreicht.`);

  await setDoc(doc(db,"superadmins", uid), { enabled:true, addedAt:serverTimestamp(), addedBy:auth.currentUser.uid }, { merge:true });
  await incCount_("superCount", +1);
  if(superUidAdd) superUidAdd.value="";
});

// Settings: vacation
vacSaveBtn && (vacSaveBtn.onclick = async ()=>{
  const v = n(vacUntil?.value);
  await saveVacation_(v);
  alertSafe_("Gespeichert ✓");
});
vacClearBtn && (vacClearBtn.onclick = async ()=>{
  await saveVacation_("");
  alertSafe_("Urlaubsmodus aus ✓");
});

/* ---------------- admin sub-tabs ---------------- */
function setAdminTab_(name){
  const tabs = {
    employees:[admTabEmployees, admEmployees],
    plan:[admTabPlan, admPlan],
    tools:[admTabTools, admTools],
    tags:[admTabTags, admTags],
    roles:[admTabRoles, admRoles],
    points:[admTabPoints, admPoints]
  };
  for(const k in tabs){
    const [t, v] = tabs[k];
    if(t) t.classList.toggle("active", k===name);
    if(v) show(v, k===name);
  }
}

admTabEmployees && (admTabEmployees.onclick = ()=>setAdminTab_("employees"));
admTabPlan && (admTabPlan.onclick = ()=>setAdminTab_("plan"));
admTabTools && (admTabTools.onclick = ()=>setAdminTab_("tools"));
admTabTags && (admTabTags.onclick = ()=>setAdminTab_("tags"));
admTabRoles && (admTabRoles.onclick = ()=>setAdminTab_("roles"));
admTabPoints && (admTabPoints.onclick = ()=>setAdminTab_("points"));

/* ---------------- enter app ---------------- */
function enterApp_(){
  show(loginView,false);
  show(appView,true);
  setView_("tasks");
}

/* ---------------- main tabs ---------------- */
tabTasks && (tabTasks.onclick = ()=>setView_("tasks"));
tabRides && (tabRides.onclick = ()=>setView_("rides"));
tabAdmin && (tabAdmin.onclick = ()=>setView_("admin"));
tabSettings && (tabSettings.onclick = ()=>setView_("settings"));

/* ---------------- auto midnight watcher ---------------- */
let lastMidnightKey = todayKeyNow();
setInterval(async ()=>{
  try{
    if(!auth.currentUser) return;

    const nowKey = dayKeyNow();
    if(nowKey !== lastMidnightKey){
      // day changed while app open
      lastMidnightKey = nowKey;

      // archive old day + rebuild new (admin preferred)
      // if not admin, just rebuild daily marker (reads only)
      if(isAdmin){
        await runDayChange_(todayKey);
      } else {
        // just update local day and attempt to ensure built (will no-op if already)
        todayKey = nowKey;
        todayWeekday = weekdayNow();
        await ensureDailyTasksForToday_(false);
      }
    }

    // admin cleanup rides
    await cleanupRides72hIfAdmin_();
  }catch(e){}
}, 30_000);

/* ---------------- init ---------------- */
onAuthStateChanged(auth, async ()=>{
  await ensureAnon_();

  await loadVacation_();

  // update badges
  todayKey = dayKeyNow();
  todayWeekday = weekdayNow();
  if(dayKeyBadge) dayKeyBadge.textContent = todayKey;
  if(weekdayBadge) weekdayBadge.textContent = todayWeekday === 0 ? "Sonntag (frei)" : `Wochentag: ${todayWeekday}`;

  await ensureCountsDoc_();
  await bootstrapSuperAdminOnce_();
  await seedFirstEmployeeIfEmpty_();

  const stored = n(localStorage.getItem("meName"));
  if(stored) meName = stored;

  await refreshRole_();

  // build daily tasks for today (if needed)
  // (only if not Sunday)
  await ensureDailyTasksForToday_(false);

  // start listeners
  await startStreams_();

  // login state
  if(meName){
    enterApp_();
  } else {
    show(loginView,true);
    show(appView,false);
  }
});
