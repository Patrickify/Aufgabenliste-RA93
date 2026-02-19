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
let tags = [], employees = [], hygieneCats = [];
let currentTagKey = "", selectedTaskId = "", activeCheckTaskId = null;

const $ = (id) => document.getElementById(id);
const show = (el, on) => el && el.classList.toggle("hidden", !on);
const n = (v) => String(v ?? "").trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
function keyOfName(name) { return n(name).toLowerCase().replace(/[ä]/g, "ae").replace(/[ö]/g, "oe").replace(/[ü]/g, "ue").replace(/[ß]/g, "ss").replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, ""); }
function dayKeyNow() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`; }
function monthKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
function stamp() { const d = new Date(); return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

/* --- 1. AUTH & ROLLEN-LOGIK --- */
signInAnonymously(auth);
onAuthStateChanged(auth, async user => {
  if (user && meKey) {
    const uRef = doc(db, "users", user.uid);
    await setDoc(uRef, { name: meName, nameKey: meKey }, { merge: true });
    
    // Prüfen ob Superadmin oder Admin
    const [sSnap, aSnap] = await Promise.all([
      getDoc(doc(db, "superadmins_by_name", meKey)),
      getDoc(doc(db, "admins_by_name", meKey))
    ]);
    
    isSuperAdmin = sSnap.exists() && sSnap.data()?.enabled === true;
    isAdmin = isSuperAdmin || (aSnap.exists() && aSnap.data()?.enabled === true);

    $("whoami").textContent = `${meName}${isSuperAdmin ? " (Super)" : isAdmin ? " (Admin)" : ""}`;
    show($("adminTabBtn"), isAdmin);
    show($("loginView"), false); 
    show($("appView"), true);
    
    initStreams();
    initPushSystem();
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
  else if (eSnap.data().passHash !== hash) return alert("Falsch");
  localStorage.setItem("meName", name); localStorage.setItem("meKey", key); location.reload();
};

/* --- 2. ADMIN & SUPERADMIN ACTIONS --- */

// Superadmin ernennen (Nur für Superadmins)
if ($("superUidAddBtn")) $("superUidAddBtn").onclick = async () => {
  if (!isSuperAdmin) return alert("Nur ein Superadmin darf diese Rolle vergeben!");
  const name = n($("superUidAdd").value);
  if (name) {
    await setDoc(doc(db, "superadmins_by_name", keyOfName(name)), { enabled: true });
    $("superUidAdd").value = "";
    alert(`${name} wurde zum Superadmin ernannt.`);
  }
};

// Admin ernennen (Für Admins und Superadmins)
if ($("adminUidAddBtn")) $("adminUidAddBtn").onclick = async () => {
  if (!isAdmin) return alert("Keine Berechtigung.");
  const name = n($("adminUidAdd").value); // Falls du dieses Feld im HTML hast
  if (name) {
    await setDoc(doc(db, "admins_by_name", keyOfName(name)), { enabled: true });
    alert(`${name} ist jetzt Admin.`);
  }
};

// Globales Löschen für Admin-Buttons
window.delDoc = async (col, id) => {
  if (!isAdmin) return;
  if (confirm("Löschen?")) await deleteDoc(doc(db, col, id));
};

/* --- 3. PUNKTE & ENDKONTROLLE --- */
function initAdminLogic() {
  // Aufgaben zur Abnahme
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("status", "==", "done")), s => {
    const tH = [], hH = [];
    s.docs.forEach(d => {
      const t = d.data();
      const html = `<div class="item">
        <span><b>${esc(t.text)}</b> (${t.doneBy.join(",")})</span>
        <div class="row">
          <button class="btn danger" onclick="window.rejectTask('${d.id}')">❌</button>
          <button class="btn ghost" onclick="window.finalCheck('${d.id}','${t.type}')">OK</button>
        </div>
      </div>`;
      if(t.type === "hygiene") hH.push(html); else tH.push(html);
    });
    $("finalListTasks").innerHTML = tH.join(""); $("finalListHygiene").innerHTML = hH.join("");
  });

  // Punkte-Tabelle Streams
  onSnapshot(collection(db, "points_tasks"), st => {
    onSnapshot(collection(db, "points_rides"), sr => renderPointsTable(st, sr));
  });
}

window.rejectTask = async (id) => {
  if (!isAdmin) return;
  if(confirm("Aufgabe ablehnen?")) await updateDoc(doc(db, "daily_tasks", id), { status: "open", doneBy: [], doneAt: null });
};

window.finalCheck = async (id, type) => {
  if (!isAdmin) return;
  const dRef = doc(db, "daily_tasks", id);
  const snap = await getDoc(dRef);
  const data = snap.data();
  // Punkte erst jetzt vergeben
  if (data.type !== "hygiene") {
    for (const name of data.doneBy) {
      await setDoc(doc(db, "points_tasks", keyOfName(name)), { points: increment(1) }, { merge: true });
    }
  }
  // Archiv & Löschen
  await setDoc(doc(db, "archive", monthKey(), "tasks", id), { ...data, status: "final" });
  await deleteDoc(dRef);
};

/* --- 4. FAHRTEN & PUNKTE-ABZUG --- */
$("addRideBtn").onclick = async () => {
  const name = $("rideNameSel").value, einsatz = $("rideEinsatz").value;
  if(!name || !einsatz) return;
  await addDoc(collection(db, "rides"), { name, einsatz, createdMs: Date.now(), createdAt: serverTimestamp() });
  await setDoc(doc(db, "points_rides", keyOfName(name)), { points: increment(1) }, { merge: true });
  $("rideEinsatz").value = "";
};

window.delRide = async (id, userKey) => {
  if (!isAdmin) return;
  if(!confirm("Fahrt löschen? Punkt wird abgezogen!")) return;
  await deleteDoc(doc(db, "rides", id));
  await setDoc(doc(db, "points_rides", userKey), { points: increment(-1) }, { merge: true });
};

/* --- 5. DATA STREAMS --- */
function initStreams() {
  onSnapshot(query(collection(db, "employees"), orderBy("name")), s => {
    employees = s.docs.map(d => d.data());
    const opts = employees.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join("");
    $("nameSel").innerHTML = opts; $("rideNameSel").innerHTML = opts;
    if ($("doneByCheckBoxes")) {
      $("doneByCheckBoxes").innerHTML = employees.map(e => `
        <label style="display:flex; align-items:center; gap:8px; padding:5px; background:#1a1f26; border-radius:4px;">
          <input type="checkbox" name="worker" value="${esc(e.name)}"> <span class="small">${esc(e.name)}</span>
        </label>`).join("");
    }
    if (isAdmin) $("empList").innerHTML = employees.map(e => `<div class="item"><span>${esc(e.name)}</span><button class="btn danger" onclick="window.delDoc('employees','${keyOfName(e.name)}')">X</button></div>`).join("");
  });

  onSnapshot(query(collection(db, "tags"), orderBy("tagId")), s => {
    tags = s.docs.map(d => ({id:d.id, ...d.data()}));
    renderTagList();
    if($("planTagSel")) $("planTagSel").innerHTML = tags.map(t=>`<option value="${t.tagKey}">${t.tagId}</option>`).join("");
  });

  onSnapshot(collection(db, "hygiene_cats"), s => {
    hygieneCats = s.docs.map(d => ({id:d.id, ...d.data()}));
    renderHygieneUserView();
  });
}

/* --- 6. USER LOGIK (TASKS / HYGIENE) --- */
function renderTagList() {
  const q = n($("tagSearch").value).toLowerCase();
  $("tagList").innerHTML = tags.filter(t=>t.tagId.toLowerCase().includes(q)).map(t=>`<div class="item"><span>🏷️ ${t.tagId}</span><button class="btn ghost" onclick="openTag('${t.tagKey}','${t.tagId}')">Öffnen</button></div>`).join("");
}

window.openTag = (key, id) => {
  currentTagKey = key; $("openTagTitle").textContent = `Tag: ${id}`;
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("tagKey", "==", key)), s => {
    $("taskList").innerHTML = s.docs.map(d => {
      const t = d.data(); if(t.status !== "open" && !isAdmin) return "";
      return `<div class="item"><span>${t.status==='open'?'⏳':'✅'} ${esc(t.text)}</span><button class="btn ghost" onclick="window.selectTask('${d.id}','${esc(t.text)}')">Wählen</button></div>`;
    }).join("");
  });
};

window.selectTask = (id, text) => { selectedTaskId = id; $("taskHint").textContent = "Gewählt: " + text; };

$("markSelectedDoneBtn").onclick = async () => {
  const who = Array.from(document.querySelectorAll('input[name="worker"]:checked')).map(cb => cb.value);
  if(!selectedTaskId || who.length === 0) return alert("Wähle Aufgabe & Team!");
  await updateDoc(doc(db, "daily_tasks", selectedTaskId), { status: "done", doneBy: who, doneAt: stamp() });
  selectedTaskId = ""; $("taskHint").textContent = "";
  document.querySelectorAll('input[name="worker"]').forEach(cb => cb.checked = false);
};

/* --- 7. SETUP & GENERATOR --- */
$("hygieneCatAddBtn").onclick = async () => { if(isAdmin && $("hygieneCatInp").value) await addDoc(collection(db, "hygiene_cats"), { title: $("hygieneCatInp").value }); $("hygieneCatInp").value=""; };
$("hygieneItemAddBtn").onclick = async () => {
  if (!isAdmin) return;
  const subs = $("hygieneSubtasksInp").value.split('\n').filter(l => l.trim() !== "");
  await addDoc(collection(db, "hygiene_templates"), { catId: $("hygieneItemCatSel").value, text: $("hygieneItemInp").value, subtasks: subs, type: "hygiene" });
  $("hygieneItemInp").value=""; $("hygieneSubtasksInp").value="";
};

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

/* --- UI & HELPERS --- */
function renderPointsTable(sTasks, sRides) {
  const stats = {};
  sTasks.forEach(d => { stats[d.id] = { t: d.data().points || 0, r: 0 }; });
  sRides.forEach(d => { if(!stats[d.id]) stats[d.id] = { t: 0, r: 0 }; stats[d.id].r = d.data().points || 0; });
  if($("pointsTableBody")) $("pointsTableBody").innerHTML = Object.keys(stats).map(k => `<tr><td>${k}</td><td>${stats[k].t}</td><td>${stats[k].r}</td><td>${stats[k].t + stats[k].r}</td></tr>`).join("");
}

document.querySelectorAll(".tabbtn").forEach(b => b.onclick = () => { document.querySelectorAll(".tab").forEach(t => show(t, false)); show($(b.dataset.tab), true); });
document.querySelectorAll(".subtabbtn").forEach(b => b.onclick = () => { document.querySelectorAll(".subtab").forEach(s => show(s, false)); show($(b.dataset.subtab), true); });
$("logoutBtn").onclick = () => { localStorage.clear(); location.reload(); };
$("reloadBtn").onclick = () => location.reload();
