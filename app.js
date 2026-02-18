import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { initializeFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, query, where, orderBy, limit, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ---------------- Firebase Setup ---------------- */
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
const db = initializeFirestore(app, { experimentalForceLongPolling: true, useFetchStreams: false });

/* ---------------- State & Helpers ---------------- */
let meName = localStorage.getItem("meName") || "";
let meKey = localStorage.getItem("meKey") || "";
let isAdmin = false, isSuperAdmin = false;
let tags = [], employees = [];
let currentTagKey = "", selectedTaskId = "";

const $ = (id) => document.getElementById(id);
const show = (el, on) => el && el.classList.toggle("hidden", !on);
const n = (v) => String(v ?? "").trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

function keyOfName(name) {
  return n(name).toLowerCase()
    .replace(/[ä]/g, "ae").replace(/[ö]/g, "oe").replace(/[ü]/g, "ue").replace(/[ß]/g, "ss")
    .replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "");
}
function dayKeyNow() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; }
function stamp() { const d = new Date(); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }

/* ---------------- Role System ---------------- */
async function refreshRoles() {
  if (!meKey) return;
  try {
    const [sSnap, aSnap] = await Promise.all([
      getDoc(doc(db, "superadmins_by_name", meKey)),
      getDoc(doc(db, "admins_by_name", meKey))
    ]);
    isSuperAdmin = sSnap.exists() && sSnap.data()?.enabled === true;
    isAdmin = isSuperAdmin || (aSnap.exists() && aSnap.data()?.enabled === true);

    if ($("whoami")) $("whoami").textContent = `${meName}${isSuperAdmin ? " (Super)" : isAdmin ? " (Admin)" : ""}`;
    show($("adminTabBtn"), isAdmin);
    show($("adminArea"), isAdmin);
    show($("adminLock"), !isAdmin);
    show($("adminBadge"), isAdmin);
    show($("newDailyTaskBtn"), isAdmin);
  } catch (e) { console.error("Rollenfehler", e); }
}

/* ---------------- Day Change Engine ---------------- */
async function runDayChange() {
  const today = dayKeyNow();
  const metaRef = doc(db, "meta", "day_state");
  const mSnap = await getDoc(metaRef);
  const lastDay = mSnap.exists() ? mSnap.data().lastDayKey : "";

  if (lastDay === today) return;
  if (!isAdmin) return; 

  const wd = new Date().getDay() === 0 ? 7 : new Date().getDay();
  const wSnap = await getDocs(query(collection(db, "weekly_tasks"), where("weekday", "==", wd), where("active", "==", true)));
  
  const batch = writeBatch(db);
  wSnap.forEach(tDoc => {
    const data = tDoc.data();
    const newTaskRef = doc(collection(db, "daily_tasks"));
    batch.set(newTaskRef, { ...data, dateKey: today, status: "open", doneBy: [], createdAt: serverTimestamp() });
  });
  
  batch.set(metaRef, { lastDayKey: today, updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}

/* ---------------- Login ---------------- */
if ($("loginBtn")) $("loginBtn").onclick = async () => {
  const name = n($("nameSel")?.value), pass = n($("passInp")?.value);
  if (!name || !pass) return;

  const key = keyOfName(name);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}:${pass}`))
    .then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, "0")).join(""));
  
  if (!auth.currentUser) await signInAnonymously(auth);
  await setDoc(doc(db, "users", auth.currentUser.uid), { name, nameKey: key }, { merge: true });

  const eSnap = await getDoc(doc(db, "employees", key));
  if (!eSnap.exists()) return alert("Name nicht in Mitarbeiterliste.");
  
  if (!eSnap.data().passHash) {
    await updateDoc(doc(db, "employees", key), { passHash: hash });
  } else if (eSnap.data().passHash !== hash) {
    return alert("Falsches Passwort.");
  }

  localStorage.setItem("meName", name); localStorage.setItem("meKey", key);
  location.reload();
};

/* ---------------- Realtime Streams ---------------- */
function initStreams() {
  onSnapshot(query(collection(db, "employees"), orderBy("name")), s => { 
    employees = s.docs.map(d => d.data());
    const opts = employees.map(e => `<option value="${e.name}">${e.name}</option>`).join("");
    if ($("nameSel")) $("nameSel").innerHTML = opts;
    if ($("doneBySel")) $("doneBySel").innerHTML = opts;
    if ($("rideNameSel")) $("rideNameSel").innerHTML = opts;
    renderAdminEmployees();
  });

  onSnapshot(query(collection(db, "tags"), orderBy("tagId")), s => { 
    tags = s.docs.map(d => ({id: d.id, ...d.data()})); 
    renderTagList();
    if ($("planTagSel")) $("planTagSel").innerHTML = tags.map(t => `<option value="${t.tagKey}">${t.tagId}</option>`).join("");
    renderAdminTags();
  });

  onSnapshot(query(collection(db, "rides"), orderBy("createdAt", "desc"), limit(50)), s => {
    const cutoff = Date.now() - (72 * 60 * 60 * 1000);
    $("ridesList").innerHTML = s.docs.filter(d => d.data().createdMs > cutoff).map(d => `
      <div class="item"><span>🚗 ${d.data().name}: ${d.data().einsatz}</span><small>${d.data().at}</small></div>
    `).join("");
  });

  onSnapshot(collection(db, "points_tasks"), s => {
    $("pointsList").innerHTML = s.docs.map(d => `<div class="item"><b>${d.id}</b>: ${d.data().points} Aufgaben-Pkt</div>`).join("");
  });
}

function renderTagList() {
  const search = n($("tagSearch")?.value).toLowerCase();
  $("tagList").innerHTML = tags.filter(t => t.tagId.toLowerCase().includes(search)).map(t => `
    <div class="item"><span>🏷️ ${t.tagId}</span><button class="btn ghost" onclick="openTag('${t.tagKey}')">Öffnen</button></div>
  `).join("");
}

window.openTag = (tagKey) => {
  currentTagKey = tagKey;
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("tagKey", "==", tagKey)), s => {
    $("taskList").innerHTML = s.docs.map(d => `
      <div class="item">
        <div class="main"><b>${d.data().status === 'open' ? '⏳' : '✅'} ${d.data().text}</b></div>
        <button class="btn ghost" onclick="selectTask('${d.id}', '${esc(d.data().text)}')">Wählen</button>
      </div>
    `).join("");
  });
};

window.selectTask = (id, text) => { selectedTaskId = id; $("taskHint").textContent = `Ausgewählt: ${text}`; };

/* ---------------- Tasks & Rides Actions ---------------- */
$("markSelectedDoneBtn").onclick = async () => {
  const who = Array.from($("doneBySel").selectedOptions).map(o => o.value);
  if (selectedTaskId && who.length) {
    await updateDoc(doc(db, "daily_tasks", selectedTaskId), { status: "done", doneBy: who, doneAt: stamp() });
    selectedTaskId = ""; $("taskHint").textContent = "";
  }
};

$("addRideBtn").onclick = async () => {
  const name = $("rideNameSel").value, einsatz = n($("rideEinsatz").value);
  if (!einsatz) return;
  await addDoc(collection(db, "rides"), { name, einsatz, at: stamp(), createdMs: Date.now(), createdAt: serverTimestamp() });
  const pRef = doc(db, "points_rides", keyOfName(name));
  const pSnap = await getDoc(pRef);
  await setDoc(pRef, { points: (pSnap.exists() ? pSnap.data().points : 0) + 1 }, { merge: true });
  $("rideEinsatz").value = ""; $("rideInfo").textContent = "Gespeichert!";
  setTimeout(() => $("rideInfo").textContent = "", 2000);
};

/* ---------------- Admin Section ---------------- */
function renderAdminEmployees() {
  if (!$("empList")) return;
  $("empList").innerHTML = employees.map(e => `
    <div class="item"><span>${esc(e.name)}</span><button class="btn ghost" onclick="resetPw('${keyOfName(e.name)}')">Reset PW</button></div>
  `).join("");
}
window.resetPw = async (key) => { if(confirm("Passwort zurücksetzen?")) await updateDoc(doc(db, "employees", key), { passHash: "" }); };

$("empAddBtn").onclick = async () => {
  const name = n($("empAdd").value);
  if (name) await setDoc(doc(db, "employees", keyOfName(name)), { name, passHash: "" });
  $("empAdd").value = "";
};

function renderAdminTags() {
  if (!$("adminTagList")) return;
  $("adminTagList").innerHTML = tags.map(t => `
    <div class="item"><span>${esc(t.tagId)}</span><button class="btn danger" onclick="deleteTag('${t.id}')">🗑️</button></div>
  `).join("");
}
window.deleteTag = async (id) => { if(confirm("Tag löschen?")) await deleteDoc(doc(db, "tags", id)); };

$("tagAddBtn").onclick = async () => {
  const tid = n($("tagAdd").value);
  if (tid) await setDoc(doc(db, "tags", keyOfName(tid)), { tagId: tid, tagKey: keyOfName(tid) });
  $("tagAdd").value = "";
};

/* Admin & Superadmin hinzufügen (via Name) */
$("adminUidAddBtn").onclick = async () => {
  const name = n($("adminUidAdd").value);
  if (name) {
    await setDoc(doc(db, "admins_by_name", keyOfName(name)), { enabled: true, addedAt: serverTimestamp() });
    $("adminUidAdd").value = ""; alert(`${name} ist jetzt Admin.`);
  }
};
$("superUidAddBtn").onclick = async () => {
  const name = n($("superUidAdd").value);
  if (name) {
    await setDoc(doc(db, "superadmins_by_name", keyOfName(name)), { enabled: true, addedAt: serverTimestamp() });
    $("superUidAdd").value = ""; alert(`${name} ist jetzt Superadmin.`);
  }
};

/* ---------------- Final Check (Tools) ---------------- */
function initAdminTools() {
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("status", "==", "done")), s => {
    $("finalList").innerHTML = s.docs.map(d => `
      <div class="item">
        <span>✅ ${d.data().text} (${d.data().doneBy.join(", ")})</span>
        <button class="btn ghost" onclick="finalCheck('${d.id}')">OK & Punkte</button>
      </div>
    `).join("");
  });
}
window.finalCheck = async (id) => {
  const dRef = doc(db, "daily_tasks", id);
  const dSnap = await getDoc(dRef);
  const data = dSnap.data();
  await updateDoc(dRef, { status: "final", finalBy: meName });
  for (const name of data.doneBy) {
    const pRef = doc(db, "points_tasks", keyOfName(name));
    const pSnap = await getDoc(pRef);
    await setDoc(pRef, { points: (pSnap.exists() ? pSnap.data().points : 0) + 1 }, { merge: true });
  }
};

/* ---------------- Boot & Tab Logic ---------------- */
onAuthStateChanged(auth, async user => {
  if (user && meKey) {
    await setDoc(doc(db, "users", user.uid), { name: meName, nameKey: meKey }, { merge: true });
    await refreshRoles();
    show($("loginView"), false); show($("appView"), true);
    initStreams();
    if (isAdmin) { initAdminTools(); runDayChange(); }
  } else { show($("loginView"), true); }
});

$("logoutBtn").onclick = () => { localStorage.clear(); signOut(auth).then(() => location.reload()); };
$("reloadBtn").onclick = () => location.reload();

document.querySelectorAll(".tabbtn").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tab").forEach(t => show(t, false));
  show($(b.dataset.tab), true);
  document.querySelectorAll(".tabbtn").forEach(btn => btn.classList.remove("active"));
  b.classList.add("active");
});
document.querySelectorAll(".subtabbtn").forEach(b => b.onclick = () => {
  document.querySelectorAll(".subtab").forEach(s => show(s, false));
  show($(b.dataset.subtab), true);
  document.querySelectorAll(".subtabbtn").forEach(btn => btn.classList.remove("active"));
  b.classList.add("active");
});
if ($("tagSearch")) $("tagSearch").oninput = renderTagList;
