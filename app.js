import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { initializeFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, query, where, orderBy, limit, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
const db = initializeFirestore(app, { experimentalForceLongPolling: true, useFetchStreams: false });

/* --- State --- */
let meName = localStorage.getItem("meName") || "", meKey = localStorage.getItem("meKey") || "";
let isAdmin = false, isSuperAdmin = false;
let tags = [], employees = [], hygieneCats = [];
let currentTagKey = "", selectedTaskId = "";

const $ = (id) => document.getElementById(id);
const show = (el, on) => el && el.classList.toggle("hidden", !on);
const n = (v) => String(v ?? "").trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
function keyOfName(name) { return n(name).toLowerCase().replace(/[ä]/g, "ae").replace(/[ö]/g, "oe").replace(/[ü]/g, "ue").replace(/[ß]/g, "ss").replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, ""); }
function dayKeyNow() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`; }
function stamp() { const d = new Date(); return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
function getWeekday() { const d = new Date().getDay(); return d === 0 ? 7 : d; }

/* --- 1. BOOTSTRAP --- */
signInAnonymously(auth).catch(console.error);
onSnapshot(query(collection(db, "employees"), orderBy("name")), s => {
  employees = s.docs.map(d => d.data());
  const sel = $("nameSel");
  if (!sel) return;
  if (employees.length === 0) {
    sel.innerHTML = `<option>DB LEER - Admin erstellen?</option>`;
    if (!$("createFirstAdminBtn")) {
      const btn = document.createElement("button");
      btn.id = "createFirstAdminBtn"; btn.className = "btn danger"; btn.innerText = "Admin 'Patrick' erstellen";
      btn.onclick = async () => { 
        await setDoc(doc(db, "employees", "patrick"), { name: "Patrick", passHash: "" }); 
        await setDoc(doc(db, "superadmins_by_name", "patrick"), { enabled: true }); 
        location.reload(); 
      };
      $("loginView").appendChild(btn);
    }
  } else {
    const stored = localStorage.getItem("meName");
    const opts = employees.map(e => `<option value="${esc(e.name)}" ${stored===e.name?'selected':''}>${esc(e.name)}</option>`).join("");
    sel.innerHTML = `<option value="">Wählen...</option>` + opts;
    if ($("doneBySel")) $("doneBySel").innerHTML = opts;
    if ($("rideNameSel")) $("rideNameSel").innerHTML = opts;
  }
});

/* --- 2. LOGIN --- */
if ($("loginBtn")) $("loginBtn").onclick = async () => {
  const name = n($("nameSel")?.value), pass = n($("passInp")?.value);
  if (!name || !pass) return alert("Fehlende Eingaben.");
  const key = keyOfName(name);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}:${pass}`)).then(b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join(""));
  
  if (auth.currentUser) await setDoc(doc(db, "users", auth.currentUser.uid), { name, nameKey: key }, { merge: true });
  const eRef = doc(db, "employees", key);
  const eSnap = await getDoc(eRef);
  if (!eSnap.exists()) return alert("User unbekannt.");
  if (!eSnap.data().passHash) await updateDoc(eRef, { passHash: hash });
  else if (eSnap.data().passHash !== hash) return alert("Falsches Passwort.");
  
  localStorage.setItem("meName", name); localStorage.setItem("meKey", key);
  location.reload();
};

/* --- 3. MAIN APP LOGIC --- */
onAuthStateChanged(auth, async user => {
  if (user && meKey) {
    await setDoc(doc(db, "users", user.uid), { name: meName, nameKey: meKey }, { merge: true });
    try {
      const [s, a] = await Promise.all([getDoc(doc(db, "superadmins_by_name", meKey)), getDoc(doc(db, "admins_by_name", meKey))]);
      isSuperAdmin = s.exists() && s.data()?.enabled; 
      isAdmin = isSuperAdmin || (a.exists() && a.data()?.enabled);
      
      $("whoami").textContent = `${meName}${isSuperAdmin?"(S)":isAdmin?"(A)":""}`;
      show($("adminTabBtn"), isAdmin); show($("adminArea"), isAdmin); show($("adminLock"), !isAdmin); show($("newDailyTaskBtn"), isAdmin); show($("adminBadge"), isAdmin);
      show($("loginView"), false); show($("appView"), true);
      
      initStreams();
      if (isAdmin) { initAdminLogic(); runDayChange(); }
    } catch(e) { console.error(e); }
  } else { show($("loginView"), true); }
});

function initStreams() {
  onSnapshot(query(collection(db, "tags")), s => {
    tags = s.docs.map(d => ({id:d.id, ...d.data()}));
    tags.sort((a,b) => (a.tagId||"").localeCompare(b.tagId||""));
    renderTags();
    if ($("planTagSel")) $("planTagSel").innerHTML = `<option value="">-- Alle --</option>` + tags.map(t => `<option value="${t.tagKey}">${t.tagId}</option>`).join("");
    if ($("adminTagList")) renderAdminTags();
  });
  
  onSnapshot(collection(db, "hygiene_cats"), s => {
    hygieneCats = s.docs.map(d => ({id:d.id, ...d.data()}));
    hygieneCats.sort((a,b) => (a.title||"").localeCompare(b.title||""));
    renderHygieneUserView();
    if (isAdmin) renderHygieneAdmin();
  });

  onSnapshot(query(collection(db, "rides"), orderBy("createdAt", "desc"), limit(100)), s => {
    const cutoff = Date.now() - (72*60*60*1000);
    let list = s.docs.map(d => ({id: d.id, ...d.data()}));
    if (!isAdmin) list = list.filter(d => d.createdMs > cutoff);

    $("ridesList").innerHTML = list.map(d => {
      const delBtn = isAdmin ? `<button class="btn danger" onclick="deleteRide('${d.id}')">X</button>` : ``;
      return `<div class="item"><div class="main"><b>🚗 ${esc(d.name)}</b><br><span class="muted">Einsatz: ${esc(d.einsatz)}</span><div class="small muted">${d.at}</div></div>${delBtn}</div>`;
    }).join("");
  });
  
  onSnapshot(collection(db, "points_tasks"), s => $("pointsList").innerHTML = s.docs.map(d=>`<div class="item"><b>${d.id}</b>: ${d.data().points} Pkt</div>`).join(""));
}

window.deleteRide = async (id) => { if (confirm("Fahrt wirklich löschen?")) await deleteDoc(doc(db, "rides", id)); };

/* --- 4. AUFGABEN TAB --- */
function renderTags() {
  const q = n($("tagSearch").value).toLowerCase();
  $("tagList").innerHTML = tags.filter(t=>t.tagId.toLowerCase().includes(q)).map(t=>`
    <div class="item"><span>🏷️ ${t.tagId}</span><button class="btn ghost" onclick="openTag('${t.tagKey}','${t.tagId}')">Öffnen</button></div>
  `).join("");
}
window.openTag = (key, id) => {
  currentTagKey = key; $("openTagTitle").textContent = `Tag: ${id}`;
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("tagKey", "==", key), where("type", "==", "task")), s => {
    $("taskList").innerHTML = s.docs.map(d=> renderTaskItem(d)).join("");
  });
};
function renderTaskItem(d) {
  const t = d.data();
  if (!isAdmin && t.status !== "open") return "";
  return `<div class="item ${t.status==='done'?'done':''}">
    <div class="main"><b>${t.status==='open'?'⏳':'✅'} ${esc(t.text)}</b><div class="small muted">${t.doneBy.join(", ")}</div></div>
    <button class="btn ghost" onclick="selectTask('${d.id}','${esc(t.text)}')">Wählen</button>
  </div>`;
}
window.selectTask = (id, txt) => { selectedTaskId = id; $("taskHint").textContent = `Gewählt: ${txt}`; };

$("markSelectedDoneBtn").onclick = async () => {
  const who = Array.from($("doneBySel").selectedOptions).map(o=>o.value);
  if (!selectedTaskId || !who.length) return alert("Fehlt was.");
  await updateDoc(doc(db, "daily_tasks", selectedTaskId), { status: "done", doneBy: who, doneAt: stamp() });
  selectedTaskId = ""; $("taskHint").textContent = "";
};

if ($("newDailyTaskBtn")) $("newDailyTaskBtn").onclick = async () => {
  if (!currentTagKey) return alert("Erst Tag öffnen.");
  const txt = prompt("Text:");
  if (txt) await addDoc(collection(db, "daily_tasks"), { text: txt, tagKey: currentTagKey, dateKey: dayKeyNow(), status: "open", doneBy: [], type: "task", createdAt: serverTimestamp() });
};

/* --- 5. HYGIENE TAB (User) --- */
function renderHygieneUserView() {
  const container = $("hygieneUserList");
  if (!container) return;
  container.innerHTML = "";
  
  hygieneCats.forEach(cat => {
    const div = document.createElement("div");
    div.innerHTML = `<h3 style="margin-top:15px; border-bottom:1px solid #333; padding-bottom:5px;">${esc(cat.title)}</h3><div id="hyg_list_${cat.id}" class="list">Lade...</div>`;
    container.appendChild(div);
    
    onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("catId", "==", cat.id), where("type", "==", "hygiene")), s => {
      const listDiv = document.getElementById(`hyg_list_${cat.id}`);
      if(s.empty) { listDiv.innerHTML = `<div class="muted small">Leer / Erledigt</div>`; return; }
      
      listDiv.innerHTML = s.docs.map(d => {
        const t = d.data();
        if (t.status !== "open" && !isAdmin) return ""; 
        return `<div class="item">
          <div class="main"><span>${esc(t.text)}</span></div>
          <button class="btn ghost" onclick="finishHygiene('${d.id}')">Abhaken</button>
        </div>`;
      }).join("");
    });
  });
}
window.finishHygiene = async (id) => {
  if(!confirm("Erledigt?")) return;
  await updateDoc(doc(db, "daily_tasks", id), { status: "done", doneBy: [meName], doneAt: stamp() });
};

/* --- 6. FAHRTEN ADD --- */
$("addRideBtn").onclick = async () => {
  const name = $("rideNameSel").value, einsatz = n($("rideEinsatz").value);
  if (!einsatz) return;
  await addDoc(collection(db, "rides"), { name, einsatz, at: stamp(), createdMs: Date.now(), createdAt: serverTimestamp() });
  const pRef = doc(db, "points_rides", keyOfName(name));
  const snap = await getDoc(pRef);
  await setDoc(pRef, { points: (snap.exists()?snap.data().points:0)+1 }, { merge: true });
  $("rideEinsatz").value = ""; $("rideInfo").textContent = "Gespeichert!";
};

/* --- 7. ADMIN FUNCTIONS (HIER WURDE GEÄNDERT!) --- */
function initAdminLogic() {
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("status", "==", "done")), s => {
    const taskListHTML = [];
    const hygieneListHTML = [];
    
    s.docs.forEach(d => {
      const t = d.data();
      const isHygiene = t.type === "hygiene";
      
      const html = `<div class="item" style="border-left: 3px solid ${isHygiene?'orange':'green'}">
        <div class="main">
          <b>${isHygiene ? '🧹 ' : '✅ '}${esc(t.text)}</b><br>
          <small class="muted">${t.doneBy.join(", ")}</small>
        </div>
        <div class="actions">
          <button class="btn danger" onclick="rejectTask('${d.id}')" style="margin-right:5px">❌</button>
          <button class="btn ghost" onclick="finalCheck('${d.id}', '${t.type}')">OK</button>
        </div>
      </div>`;
      
      if (isHygiene) hygieneListHTML.push(html);
      else taskListHTML.push(html);
    });
    
    // In zwei verschiedene Listen schreiben
    if($("finalListTasks")) $("finalListTasks").innerHTML = taskListHTML.length ? taskListHTML.join("") : `<div class="muted small">Keine offenen Aufgaben</div>`;
    if($("finalListHygiene")) $("finalListHygiene").innerHTML = hygieneListHTML.length ? hygieneListHTML.join("") : `<div class="muted small">Keine offenen Checks</div>`;
  });
  
  onSnapshot(collection(db, "hygiene_templates"), s => {
    $("hygieneTemplateList").innerHTML = s.docs.map(d => `<div class="item"><span>${esc(d.data().text)} (${d.data().catTitle})</span><button class="btn danger" onclick="delHygTpl('${d.id}')">X</button></div>`).join("");
  });
}

window.rejectTask = async (id) => {
  if(!confirm("Zurückweisen (Nicht erledigt)?")) return;
  await updateDoc(doc(db, "daily_tasks", id), { status: "open", doneBy: [], doneAt: null });
};

window.finalCheck = async (id, type) => {
  const dRef = doc(db, "daily_tasks", id);
  const snap = await getDoc(dRef);
  await updateDoc(dRef, { status: "final", finalBy: meName });
  if (type !== "hygiene") {
    for (const name of snap.data().doneBy) {
      const pRef = doc(db, "points_tasks", keyOfName(name));
      const pSnap = await getDoc(pRef);
      await setDoc(pRef, { points: (pSnap.exists()?pSnap.data().points:0)+1 }, { merge: true });
    }
  }
};

/* Admin: Wochenplan */
const refreshWeekly = () => {
  const wdVal = $("planWeekdaySel").value; 
  const tagKey = $("planTagSel").value;
  let q;
  if (wdVal === "all") {
    q = tagKey ? query(collection(db, "weekly_tasks"), where("tagKey", "==", tagKey)) : collection(db, "weekly_tasks");
  } else {
    const wd = Number(wdVal);
    q = tagKey ? query(collection(db, "weekly_tasks"), where("weekday", "==", wd), where("tagKey", "==", tagKey)) : query(collection(db, "weekly_tasks"), where("weekday", "==", wd));
  }
  
  onSnapshot(q, s => {
    let docs = s.docs.map(d => ({id:d.id, ...d.data()}));
    docs.sort((a,b) => a.weekday - b.weekday);
    const days = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    $("planList").innerHTML = docs.map(w => {
      return `<div class="item">
        <span><b>${days[w.weekday] || w.weekday}:</b> ${esc(w.text)} <small>(${w.tagKey})</small></span>
        <button class="btn danger" onclick="deleteWeekly('${w.id}')">🗑️</button>
      </div>`;
    }).join("");
  });
};
$("planWeekdaySel").onchange = refreshWeekly; $("planTagSel").onchange = refreshWeekly;
window.deleteWeekly = async (id) => deleteDoc(doc(db, "weekly_tasks", id));

$("planAddBtn").onclick = async () => {
  const txt = n($("planTaskInp").value), wd = $("planWeekdaySel").value, tag = $("planTagSel").value;
  if (!txt || wd === "all" || !tag) return alert("Bitte Tag & Bereich wählen.");
  await addDoc(collection(db, "weekly_tasks"), { text: txt, tagKey: tag, weekday: Number(wd), active: true });
  $("planTaskInp").value = "";
};

/* Admin: Hygiene Setup */
$("hygieneCatAddBtn").onclick = async () => { 
  try {
    const t = n($("hygieneCatInp").value);
    if(t) await addDoc(collection(db, "hygiene_cats"), { title: t });
    $("hygieneCatInp").value = "";
  } catch (e) { alert("Fehler: " + e.message); }
};
function renderHygieneAdmin() {
  $("hygieneCatList").innerHTML = hygieneCats.map(c => `<div class="item"><span>${esc(c.title)}</span><button class="btn danger" onclick="delHygCat('${c.id}')">X</button></div>`).join("");
  $("hygieneItemCatSel").innerHTML = hygieneCats.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join("");
}
$("hygieneItemAddBtn").onclick = async () => {
  try {
    const txt = n($("hygieneItemInp").value), catId = $("hygieneItemCatSel").value;
    if(!txt || !catId) return alert("Text/Kat fehlt");
    const catTitle = hygieneCats.find(c=>c.id===catId)?.title || "";
    await addDoc(collection(db, "hygiene_templates"), { text: txt, catId, catTitle });
    $("hygieneItemInp").value = "";
  } catch (e) { alert("Fehler: " + e.message); }
};
window.delHygCat = (id) => deleteDoc(doc(db, "hygiene_cats", id));
window.delHygTpl = (id) => deleteDoc(doc(db, "hygiene_templates", id));

/* --- 8. GENERATOR --- */
async function generateTasksForToday(dateKey) {
  const batch = writeBatch(db);
  const wd = new Date().getDay() || 7; 
  const wSnap = await getDocs(query(collection(db, "weekly_tasks"), where("weekday", "==", wd), where("active", "==", true)));
  wSnap.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey, status: "open", doneBy: [], type: "task", createdAt: serverTimestamp() }));
  const hSnap = await getDocs(collection(db, "hygiene_templates"));
  hSnap.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey, status: "open", doneBy: [], type: "hygiene", createdAt: serverTimestamp() }));
  await batch.commit();
}
async function runDayChange() {
  const today = dayKeyNow();
  const mSnap = await getDoc(doc(db, "meta", "day_state"));
  if (mSnap.exists() && mSnap.data().lastDayKey === today) return;
  await generateTasksForToday(today);
  await setDoc(doc(db, "meta", "day_state"), { lastDayKey: today }, { merge: true });
}
if($("regenTestBtn")) $("regenTestBtn").onclick = async () => {
  if(!confirm("ALLES von heute löschen & neu generieren?")) return;
  const today = dayKeyNow();
  const exist = await getDocs(query(collection(db, "daily_tasks"), where("dateKey", "==", today)));
  const batch = writeBatch(db);
  exist.forEach(d => batch.delete(d.ref));
  await batch.commit();
  await generateTasksForToday(today);
  alert("Erledigt!");
};

/* --- HELPERS --- */
$("logoutBtn").onclick = () => { localStorage.clear(); signOut(auth).then(()=>location.reload()); };
$("reloadBtn").onclick = () => location.reload();
document.querySelectorAll(".tabbtn").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tab").forEach(t => show(t, false)); show($(b.dataset.tab), true);
  document.querySelectorAll(".tabbtn").forEach(x => x.classList.remove("active")); b.classList.add("active");
});
document.querySelectorAll(".subtabbtn").forEach(b => b.onclick = () => {
  document.querySelectorAll(".subtab").forEach(s => show(s, false)); show($(b.dataset.subtab), true);
  document.querySelectorAll(".subtabbtn").forEach(x => x.classList.remove("active")); b.classList.add("active");
});
if ($("tagSearch")) $("tagSearch").oninput = renderTags;
function renderAdminTags() {
  $("adminTagList").innerHTML = tags.map(t => `<div class="item"><span>${esc(t.tagId)}</span><button class="btn danger" onclick="deleteTag('${t.id}')">🗑️</button></div>`).join("");
}
window.deleteTag = async (id) => { if(confirm("Löschen?")) await deleteDoc(doc(db, "tags", id)); };
$("tagAddBtn").onclick = async () => { const tid = n($("tagAdd").value); if(tid) await setDoc(doc(db, "tags", keyOfName(tid)), { tagId: tid, tagKey: keyOfName(tid) }); $("tagAdd").value=""; };
$("empAddBtn").onclick = async () => { const nV=n($("empAdd").value); if(nV) await setDoc(doc(db, "employees", keyOfName(nV)), { name: nV, passHash: "" }); $("empAdd").value=""; };
$("adminUidAddBtn").onclick = async () => { const nV=n($("adminUidAdd").value); if(nV) await setDoc(doc(db, "admins_by_name", keyOfName(nV)), { enabled: true }); $("adminUidAdd").value=""; };
$("superUidAddBtn").onclick = async () => { const nV=n($("superUidAdd").value); if(nV) await setDoc(doc(db, "superadmins_by_name", keyOfName(nV)), { enabled: true }); $("superUidAdd").value=""; };
