import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
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

let meName = localStorage.getItem("meName") || "", meKey = localStorage.getItem("meKey") || "";
let isAdmin = false, isSuperAdmin = false, tags = [], employees = [], hygieneCats = [];
let selectedTaskId = "", activeCheckTaskId = null;

const $ = (id) => document.getElementById(id);
const show = (el, on) => el && el.classList.toggle("hidden", !on);
const n = (v) => String(v ?? "").trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
function keyOfName(name) { return n(name).toLowerCase().replace(/[ä]/g, "ae").replace(/[ö]/g, "oe").replace(/[ü]/g, "ue").replace(/[ß]/g, "ss").replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, ""); }
function dayKeyNow() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`; }
function stamp() { const d = new Date(); return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

/* --- 1. AUTH & NAVIGATION --- */
signInAnonymously(auth);

if($("menuToggle")) $("menuToggle").onclick = () => $("sidebar").classList.toggle("open");

onAuthStateChanged(auth, async user => {
  if (user && meKey) {
    const [sSnap, aSnap] = await Promise.all([getDoc(doc(db, "superadmins_by_name", meKey)), getDoc(doc(db, "admins_by_name", meKey))]);
    isSuperAdmin = sSnap.exists() && sSnap.data()?.enabled === true;
    isAdmin = isSuperAdmin || (aSnap.exists() && aSnap.data()?.enabled === true);
    $("whoami").textContent = meName + (isAdmin ? " (A)" : "");
    show($("adminTabBtn"), isAdmin); show($("loginView"), false); show($("appView"), true);
    initAppDataStreams();
    if (isAdmin) { initAdminLogic(); runDayChange(); }
  } else { show($("loginView"), true); show($("appView"), false); }
});

$("loginBtn").onclick = async () => {
  const inputName = n($("nameInp").value);
  if (!inputName) return alert("Name eingeben!");
  const testKey = keyOfName(inputName);
  const empSnap = await getDoc(doc(db, "employees", testKey));
  if (empSnap.exists()) {
    localStorage.setItem("meName", empSnap.data().name);
    localStorage.setItem("meKey", testKey);
    location.reload();
  } else { alert("Name nicht registriert!"); }
};

/* --- 2. DATA STREAMS --- */
function initAppDataStreams() {
  onSnapshot(query(collection(db, "employees"), orderBy("name")), s => {
    employees = s.docs.map(d => d.data());
    if($("doneByCheckBoxes")) $("doneByCheckBoxes").innerHTML = employees.map(e => `<label class="check-item"><input type="checkbox" name="worker" value="${esc(e.name)}"> <span>${esc(e.name)}</span></label>`).join("");
    if($("rideNameSel")) $("rideNameSel").innerHTML = employees.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join("");
  });
  onSnapshot(query(collection(db, "tags"), orderBy("tagId")), s => {
    tags = s.docs.map(d => ({id:d.id, ...d.data()}));
    renderTagList();
    if($("planTagSel")) $("planTagSel").innerHTML = tags.map(t=>`<option value="${t.tagKey}">${t.tagId}</option>`).join("");
  });
  onSnapshot(query(collection(db, "rides"), orderBy("createdAt", "desc"), limit(50)), s => {
    if($("ridesList")) $("ridesList").innerHTML = s.docs.map(d => `<div class="item"><span>🚗 ${esc(d.data().name)} (${esc(d.data().einsatz)})</span>${isAdmin ? `<button class="btn danger" onclick="window.delRide('${d.id}', '${keyOfName(d.data().name)}')">X</button>` : ''}</div>`).join("");
  });
  onSnapshot(collection(db, "hygiene_cats"), s => {
    hygieneCats = s.docs.map(d => ({id: d.id, ...d.data()}));
    renderHygieneUserView();
  });
}

/* --- 3. AUFGABEN-LOGIK --- */
function renderTagList() {
  const q = n($("tagSearch").value).toLowerCase();
  $("tagList").innerHTML = tags.filter(t=>t.tagId.toLowerCase().includes(q)).map(t=>`
    <div class="item"><span>🏷️ ${esc(t.tagId)}</span><button class="btn ghost" onclick="window.openTag('${t.tagKey}','${esc(t.tagId)}')">Öffnen</button></div>`).join("");
}

window.openTag = (key, id) => {
  $("openTagTitle").textContent = `Bereich: ${id}`;
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("tagKey", "==", key)), s => {
    const list = $("taskList");
    const openTasks = s.docs.filter(d => d.data().status === "open");
    list.innerHTML = openTasks.length === 0 ? '<p class="muted">Keine Aufgaben.</p>' : 
      openTasks.map(d => `<div class="item"><span>${esc(d.data().text)}</span><button class="btn ghost" onclick="window.selectTask('${d.id}', '${esc(d.data().text)}')">Wählen</button></div>`).join("");
  });
};

window.selectTask = (id, text) => { selectedTaskId = id; $("taskHint").textContent = "Gewählt: " + text; };

$("markSelectedDoneBtn").onclick = async () => {
  const who = Array.from(document.querySelectorAll('input[name="worker"]:checked')).map(cb => cb.value);
  if(!selectedTaskId || who.length === 0) return alert("Person wählen!");
  await updateDoc(doc(db, "daily_tasks", selectedTaskId), { status: "done", doneBy: who, doneAt: stamp() });
  selectedTaskId = ""; $("taskHint").textContent = "";
  document.querySelectorAll('input[name="worker"]').forEach(cb => cb.checked = false);
};

/* --- 4. ADMIN & WOCHENPLAN --- */
function initAdminLogic() {
  const updatePlanFilter = () => {
    const d = Number($("planDaySel").value), t = $("planTagSel").value;
    onSnapshot(query(collection(db, "weekly_tasks"), where("weekday", "==", d), where("tagKey", "==", t)), s => {
      $("planList").innerHTML = s.docs.map(doc => `<div class="item"><span>${esc(doc.data().text)}</span><button class="btn danger" onclick="window.delDoc('weekly_tasks','${doc.id}')">X</button></div>`).join("");
    });
  };
  if($("planDaySel")) $("planDaySel").onchange = updatePlanFilter;
  if($("planTagSel")) $("planTagSel").onchange = updatePlanFilter;
  updatePlanFilter();

  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("status", "==", "done")), s => {
    $("finalListTasks").innerHTML = s.docs.map(d => `<div class="item"><span>${esc(d.data().text)} (${d.data().doneBy.join(",")})</span><div class="row"><button class="btn danger" onclick="window.rejectTask('${d.id}')">❌</button><button class="btn ghost" onclick="window.finalCheck('${d.id}')">OK</button></div></div>`).join("");
  });
  onSnapshot(collection(db, "points_tasks"), st => onSnapshot(collection(db, "points_rides"), sr => renderPointsTable(st, sr)));
}

/* --- 5. AUTOMATIK & TABS --- */
async function runDayChange() {
  const today = dayKeyNow(); const mS = await getDoc(doc(db, "meta", "day_state"));
  if (mS.exists() && mS.data().lastDayKey === today) return;
  const batch = writeBatch(db); const wd = new Date().getDay() || 7;
  const wSnap = await getDocs(query(collection(db, "weekly_tasks"), where("weekday", "==", wd)));
  wSnap.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey: today, status: "open", doneBy: [] }));
  await batch.set(doc(db, "meta", "day_state"), { lastDayKey: today }, { merge: true });
  await batch.commit();
}

function setupTabs(btnClass, tabClass) {
  document.querySelectorAll(btnClass).forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(tabClass).forEach(t => t.classList.add("hidden"));
      $(btn.dataset.tab || btn.dataset.subtab).classList.remove("hidden");
      document.querySelectorAll(btnClass).forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      if(window.innerWidth <= 768) $("sidebar").classList.remove("open");
    };
  });
}
setupTabs(".tabbtn", ".tab"); setupTabs(".subtabbtn", ".subtab");

/* --- 6. HELPERS & PUNKTE --- */
$("saveRideBtn").onclick = async () => {
  const name = $("rideNameSel").value, einsatz = $("rideEinsatz").value;
  if(!name || !einsatz) return;
  await addDoc(collection(db, "rides"), { name, einsatz, createdAt: serverTimestamp() });
  await setDoc(doc(db, "points_rides", keyOfName(name)), { points: increment(1) }, { merge: true });
  $("rideEinsatz").value = "";
};

window.finalCheck = async (id) => {
  const snap = await getDoc(doc(db, "daily_tasks", id));
  if(snap.exists() && snap.data().doneBy) {
    for (const name of snap.data().doneBy) await setDoc(doc(db, "points_tasks", keyOfName(name)), { points: increment(1) }, { merge: true });
  }
  await deleteDoc(doc(db, "daily_tasks", id));
};

window.delRide = async (id, userKey) => {
  if(!confirm("Punkt abziehen?")) return;
  await deleteDoc(doc(db, "rides", id));
  await setDoc(doc(db, "points_rides", userKey), { points: increment(-1) }, { merge: true });
};

function renderPointsTable(st, sr) {
  const res = {};
  st.forEach(d => res[d.id] = { t: d.data().points||0, r: 0 });
  sr.forEach(d => { if(!res[d.id]) res[d.id]={t:0,r:0}; res[d.id].r = d.data().points||0; });
  $("pointsTableBody").innerHTML = Object.keys(res).map(k => `<tr><td>${k}</td><td>${res[k].t}</td><td>${res[k].r}</td><td><b>${res[k].t+res[k].r}</b></td></tr>`).join("");
}

window.delDoc = async (col, id) => { if(confirm("Löschen?")) await deleteDoc(doc(db, col, id)); };
$("logoutBtn").onclick = () => { localStorage.clear(); location.reload(); };
$("reloadBtn").onclick = () => location.reload();
$("closeModalBtn").onclick = () => show($("checkModal"), false);
$("regenTestBtn").onclick = async () => { if(confirm("Reset?")) { const ex = await getDocs(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()))); const b = writeBatch(db); ex.forEach(d => b.delete(d.ref)); await b.commit(); location.reload(); } };
