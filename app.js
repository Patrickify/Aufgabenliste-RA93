import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { initializeFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, query, where, orderBy, limit, serverTimestamp, writeBatch, increment } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCPTt1ZZ-lj5qZ1Rrn-N7e5QZnhtXB-Pu8",
  authDomain: "aufgabenliste-zdl-ra-93.firebaseapp.com",
  projectId: "aufgabenliste-zdl-ra-93",
  storageBucket: "aufgabenliste-zdl-ra-93.firebasestorage.app",
  messagingSenderId: "857214150388",
  appId: "1:857214150388:web:8bc019911092be0cffe0a1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });

/* --- STATE --- */
let meName = localStorage.getItem("meName") || "", meKey = localStorage.getItem("meKey") || "";
let isAdmin = false, isSuperAdmin = false, myMuteUntil = "";
let employees = [], tags = [], hygieneCats = [];
let currentTagKey = "", selectedTaskId = "", activeCheckTaskId = null;

const $ = (id) => document.getElementById(id);
const show = (el, on) => el && el.classList.toggle("hidden", !on);
const n = (v) => String(v ?? "").trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
function keyOfName(name) { return n(name).toLowerCase().replace(/[ä]/g, "ae").replace(/[ö]/g, "oe").replace(/[ü]/g, "ue").replace(/[ß]/g, "ss").replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, ""); }
function dayKeyNow() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`; }
function monthKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
function stamp() { const d = new Date(); return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

/* --- 1. LOGIN & AUTH --- */
signInAnonymously(auth);
onAuthStateChanged(auth, async user => {
  if (user && meKey) {
    const uRef = doc(db, "users", user.uid);
    await setDoc(uRef, { name: meName, nameKey: meKey }, { merge: true });
    const [sSnap, aSnap] = await Promise.all([getDoc(doc(db, "superadmins_by_name", meKey)), getDoc(doc(db, "admins_by_name", meKey))]);
    isSuperAdmin = sSnap.exists() && sSnap.data()?.enabled === true;
    isAdmin = isSuperAdmin || (aSnap.exists() && aSnap.data()?.enabled === true);
    $("whoami").textContent = `${meName}${isSuperAdmin ? " (S)" : isAdmin ? " (A)" : ""}`;
    show($("adminTabBtn"), isAdmin); show($("loginView"), false); show($("appView"), true);
    initStreams();
    if (isAdmin) { initAdminLogic(); runDayChange(); }
  } else { show($("loginView"), true); }
});

if ($("loginBtn")) $("loginBtn").onclick = async () => {
  const name = n($("nameSel").value), pass = n($("passInp").value);
  if (!name || !pass) return alert("Fehlende Daten");
  const key = keyOfName(name);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}:${pass}`)).then(b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join(""));
  const eSnap = await getDoc(doc(db, "employees", key));
  if (!eSnap.exists()) return alert("User unbekannt");
  if (!eSnap.data().passHash) await updateDoc(doc(db, "employees", key), { passHash: hash });
  else if (eSnap.data().passHash !== hash) return alert("Passwort falsch");
  localStorage.setItem("meName", name); localStorage.setItem("meKey", key); location.reload();
};

/* --- 2. STREAMS & USER-LOGIK --- */
function initStreams() {
  onSnapshot(query(collection(db, "employees"), orderBy("name")), s => {
    employees = s.docs.map(d => d.data());
    const opts = employees.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join("");
    $("nameSel").innerHTML = opts; $("doneBySel").innerHTML = opts; $("rideNameSel").innerHTML = opts;
  });

  onSnapshot(query(collection(db, "tags"), orderBy("tagId")), s => {
    tags = s.docs.map(d => ({id:d.id, ...d.data()}));
    renderTagList();
    if($("planTagSel")) $("planTagSel").innerHTML = tags.map(t=>`<option value="${t.tagKey}">${t.tagId}</option>`).join("");
  });

  onSnapshot(collection(db, "hygiene_cats"), s => {
    hygieneCats = s.docs.map(d => ({id:d.id, ...d.data()}));
    renderHygieneUserView();
    if(isAdmin) renderHygieneAdmin();
  });

  onSnapshot(query(collection(db, "rides"), orderBy("createdAt", "desc"), limit(50)), s => {
    $("ridesList").innerHTML = s.docs.map(d => {
      const r = d.data();
      return `<div class="item"><span>🚗 ${esc(r.name)} (${esc(r.einsatz)})</span>${isAdmin ? `<button class="btn danger" onclick="window.delRide('${d.id}', '${keyOfName(r.name)}')">X</button>` : ''}</div>`;
    }).join("");
  });
}

/* --- 3. FAHRTEN & PUNKTE (ABZUG) --- */
$("addRideBtn").onclick = async () => {
  const name = $("rideNameSel").value, einsatz = $("rideEinsatz").value;
  if(!name || !einsatz) return;
  await addDoc(collection(db, "rides"), { name, einsatz, createdMs: Date.now(), createdAt: serverTimestamp() });
  await setDoc(doc(db, "points_rides", keyOfName(name)), { points: increment(1) }, { merge: true });
  $("rideEinsatz").value = "";
};

window.delRide = async (id, userKey) => {
  if(!confirm("Fahrt löschen? Punkt wird abgezogen!")) return;
  await deleteDoc(doc(db, "rides", id));
  await setDoc(doc(db, "points_rides", userKey), { points: increment(-1) }, { merge: true });
};

/* --- 4. AUFGABEN & CHECKLISTEN --- */
function renderTagList() {
  const q = n($("tagSearch").value).toLowerCase();
  $("tagList").innerHTML = tags.filter(t=>t.tagId.toLowerCase().includes(q)).map(t=>`<div class="item"><span>🏷️ ${t.tagId}</span><button class="btn ghost" onclick="openTag('${t.tagKey}','${t.tagId}')">Öffnen</button></div>`).join("");
}

window.openTag = (key, id) => {
  currentTagKey = key; $("openTagTitle").textContent = `Tag: ${id}`;
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("tagKey", "==", key)), s => {
    $("taskList").innerHTML = s.docs.map(d => {
      const t = d.data(); if(t.status !== "open" && !isAdmin) return "";
      return `<div class="item"><span>${t.status==='open'?'⏳':'✅'} ${esc(t.text)}</span><button class="btn ghost" onclick="selectedTaskId='${d.id}';$('taskHint').textContent='Gewählt: '+ '${esc(t.text)}'">Wählen</button></div>`;
    }).join("");
  });
};

$("markSelectedDoneBtn").onclick = async () => {
  const who = Array.from($("doneBySel").selectedOptions).map(o=>o.value);
  if(!selectedTaskId || who.length === 0) return alert("Wähle Aufgabe & Team!");
  await updateDoc(doc(db, "daily_tasks", selectedTaskId), { status: "done", doneBy: who, doneAt: stamp() });
  selectedTaskId = ""; $("taskHint").textContent = "";
};

// HYGIENE CHECKLISTEN
window.openHygCheck = async (id) => {
  activeCheckTaskId = id; const snap = await getDoc(doc(db, "daily_tasks", id)); const data = snap.data();
  $("modalTitle").textContent = data.text; const cont = $("modalSubtasks"); cont.innerHTML = "";
  if (!data.subtasks || data.subtasks.length === 0) { 
    if(confirm("Abschließen?")) finishHyg(id); return; 
  }
  data.subtasks.forEach(sub => cont.innerHTML += `<label class="item"><input type="checkbox" class="sub-check"> <span>${esc(sub)}</span></label>`);
  show($("checkModal"), true);
};

async function finishHyg(id) {
  await updateDoc(doc(db, "daily_tasks", id), { status: "done", doneBy: [meName], doneAt: stamp() });
}

$("saveCheckBtn").onclick = async () => {
  if (Array.from(document.querySelectorAll(".sub-check")).every(c => c.checked)) {
    await finishHyg(activeCheckTaskId); show($("checkModal"), false);
  } else alert("Punkte fehlen!");
};

/* --- 5. ADMIN LOGIK & ABNAHME --- */
function initAdminLogic() {
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("status", "==", "done")), s => {
    const tH = [], hH = [];
    s.docs.forEach(d => {
      const t = d.data();
      const html = `<div class="item"><span>${esc(t.text)} (${t.doneBy.join(",")})</span><button class="btn ghost" onclick="window.finalCheck('${d.id}')">OK</button></div>`;
      if(t.type === "hygiene") hH.push(html); else tH.push(html);
    });
    $("finalListTasks").innerHTML = tH.join(""); $("finalListHygiene").innerHTML = hH.join("");
  });

  onSnapshot(collection(db, "points_tasks"), st => {
    onSnapshot(collection(db, "points_rides"), sr => renderPointsTable(st, sr));
  });

  // Wochenplan Stream
  onSnapshot(query(collection(db, "weekly_tasks"), orderBy("weekday")), s => {
    $("planList").innerHTML = s.docs.map(d => `<div class="item"><span>[Tag ${d.data().weekday}] ${esc(d.data().text)}</span><button class="btn danger" onclick="window.delDoc('weekly_tasks','${d.id}')">X</button></div>`).join("");
  });
}

window.finalCheck = async (id) => {
  const dRef = doc(db, "daily_tasks", id); const snap = await getDoc(dRef); const data = snap.data();
  if (data.type !== "hygiene") {
    for (const name of data.doneBy) { await setDoc(doc(db, "points_tasks", keyOfName(name)), { points: increment(1) }, { merge: true }); }
  }
  await deleteDoc(dRef);
};

function renderPointsTable(sTasks, sRides) {
  const stats = {};
  sTasks.forEach(d => { stats[d.id] = { t: d.data().points || 0, r: 0 }; });
  sRides.forEach(d => { if(!stats[d.id]) stats[d.id] = { t: 0, r: 0 }; stats[d.id].r = d.data().points || 0; });
  $("pointsTableBody").innerHTML = Object.keys(stats).map(k => `<tr><td>${k}</td><td>${stats[k].t}</td><td>${stats[k].r}</td><td>${stats[k].t + stats[k].r}</td></tr>`).join("");
}

/* --- 6. SETUP & GENERATOR --- */
$("hygieneCatAddBtn").onclick = async () => { if($("hygieneCatInp").value) await addDoc(collection(db, "hygiene_cats"), { title: $("hygieneCatInp").value }); $("hygieneCatInp").value=""; };
$("hygieneItemAddBtn").onclick = async () => {
  const subs = $("hygieneSubtasksInp").value.split('\n').filter(l => l.trim() !== "");
  await addDoc(collection(db, "hygiene_templates"), { catId: $("hygieneItemCatSel").value, text: $("hygieneItemInp").value, subtasks: subs, type: "hygiene" });
  $("hygieneItemInp").value=""; $("hygieneSubtasksInp").value="";
};
$("planAddBtn").onclick = async () => {
  await addDoc(collection(db, "weekly_tasks"), { weekday: Number($("planDaySel").value), tagKey: $("planTagSel").value, text: $("planTextInp").value, type: "task" });
  $("planTextInp").value = "";
};

// SUPERADMIN & ROLLEN
window.delDoc = async (col, id) => { if(confirm("Löschen?")) await deleteDoc(doc(db, col, id)); };
$("superUidAddBtn").onclick = async () => {
  if(!isSuperAdmin) return alert("Nur Superadmins!");
  await setDoc(doc(db, "superadmins_by_name", keyOfName($("superUidAdd").value)), { enabled: true });
  $("superUidAdd").value = "";
};
$("empAddBtn").onclick = async () => { await setDoc(doc(db, "employees", keyOfName($("empAdd").value)), { name: $("empAdd").value, passHash: "" }); };

// GENERATOR
async function runDayChange() {
  const today = dayKeyNow(); const mS = await getDoc(doc(db, "meta", "day_state"));
  if (mS.exists() && mS.data().lastDayKey === today) return;
  const batch = writeBatch(db); const wd = new Date().getDay() || 7;
  const wS = await getDocs(query(collection(db, "weekly_tasks"), where("weekday", "==", wd)));
  wS.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey: today, status: "open", doneBy: [] }));
  const hS = await getDocs(collection(db, "hygiene_templates"));
  hS.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey: today, status: "open", doneBy: [] }));
  await batch.set(doc(db, "meta", "day_state"), { lastDayKey: today }, { merge: true });
  await batch.commit();
}

/* --- UI HELPERS --- */
document.querySelectorAll(".tabbtn").forEach(b => b.onclick = () => { document.querySelectorAll(".tab").forEach(t => show(t, false)); show($(b.dataset.tab), true); });
document.querySelectorAll(".subtabbtn").forEach(b => b.onclick = () => { document.querySelectorAll(".subtab").forEach(s => show(s, false)); show($(b.dataset.subtab), true); });
$("closeModalBtn").onclick = () => show($("checkModal"), false);
$("logoutBtn").onclick = () => { localStorage.clear(); signOut(auth).then(()=>location.reload()); };
$("reloadBtn").onclick = () => location.reload();
