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
let isAdmin = false, isSuperAdmin = false, myMuteUntil = "";
let tags = [], employees = [], hygieneCats = [];
let currentTagKey = "", selectedTaskId = "", activeCheckTaskId = null;

const $ = (id) => document.getElementById(id);
const show = (el, on) => el && el.classList.toggle("hidden", !on);
const n = (v) => String(v ?? "").trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
function keyOfName(name) { return n(name).toLowerCase().replace(/[ä]/g, "ae").replace(/[ö]/g, "oe").replace(/[ü]/g, "ue").replace(/[ß]/g, "ss").replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, ""); }
function dayKeyNow() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`; }
function stamp() { const d = new Date(); return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
function getWeekday() { const d = new Date().getDay(); return d === 0 ? 7 : d; }

/* --- 1. BOOTSTRAP & LOGIN --- */
signInAnonymously(auth).catch(console.error);

onSnapshot(query(collection(db, "employees"), orderBy("name")), s => {
  employees = s.docs.map(d => d.data());
  const sel = $("nameSel");
  if (!sel) return;
  const opts = employees.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join("");
  sel.innerHTML = `<option value="">Wer bist du?</option>` + opts;
  if ($("doneBySel")) $("doneBySel").innerHTML = opts;
  if ($("rideNameSel")) $("rideNameSel").innerHTML = opts;
});

if ($("loginBtn")) $("loginBtn").onclick = async () => {
  const name = n($("nameSel")?.value), pass = n($("passInp")?.value);
  if (!name || !pass) return alert("Eingabe fehlt");
  const key = keyOfName(name);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}:${pass}`)).then(b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join(""));
  const eSnap = await getDoc(doc(db, "employees", key));
  if (!eSnap.exists()) return alert("User unbekannt");
  if (!eSnap.data().passHash) await updateDoc(doc(db, "employees", key), { passHash: hash });
  else if (eSnap.data().passHash !== hash) return alert("Falsches Passwort");
  localStorage.setItem("meName", name); localStorage.setItem("meKey", key); location.reload();
};

/* --- 2. AUTH STATE --- */
onAuthStateChanged(auth, async user => {
  if (user && meKey) {
    const uRef = doc(db, "users", user.uid);
    await setDoc(uRef, { name: meName, nameKey: meKey }, { merge: true });
    const uSnap = await getDoc(uRef);
    if(uSnap.exists()) { 
      myMuteUntil = uSnap.data().muteUntil || ""; 
      if($("muteUntilInp")) $("muteUntilInp").value = myMuteUntil; 
      updateMuteStatus(); 
    }

    const [s, a] = await Promise.all([getDoc(doc(db, "superadmins_by_name", meKey)), getDoc(doc(db, "admins_by_name", meKey))]);
    isSuperAdmin = s.exists() && s.data()?.enabled; 
    isAdmin = isSuperAdmin || (a.exists() && a.data()?.enabled);
    
    $("whoami").textContent = `${meName}${isAdmin?" (A)":""}`;
    show($("adminTabBtn"), isAdmin);
    show($("loginView"), false); show($("appView"), true);
    
    initStreams();
    initPushSystem();
    if (isAdmin) { initAdminLogic(); runDayChange(); }
  } else { show($("loginView"), true); }
});

/* --- 3. PUSH & SETTINGS --- */
function initPushSystem() {
  $("settingsBtn").onclick = () => show($("settingsCard"), true);
  $("closeSettingsBtn").onclick = () => show($("settingsCard"), false);
  $("reqPermBtn").onclick = () => Notification.requestPermission().then(p => { if(p==="granted") new Notification("Aktiv!"); });
  
  $("saveMuteBtn").onclick = async () => { 
    const v = $("muteUntilInp").value; 
    myMuteUntil = v; 
    await updateDoc(doc(db, "users", auth.currentUser.uid), { muteUntil: v }); 
    updateMuteStatus(); alert("Urlaub gespeichert!"); 
  };
  
  $("clearMuteBtn").onclick = async () => { 
    myMuteUntil = ""; 
    await updateDoc(doc(db, "users", auth.currentUser.uid), { muteUntil: "" }); 
    updateMuteStatus(); 
  };
  setInterval(checkPushTime, 60000);
}

function updateMuteStatus() { 
  if($("muteStatus")) $("muteStatus").textContent = (myMuteUntil && Number(myMuteUntil) >= Number(dayKeyNow())) ? "🔕 Stumm bis " + myMuteUntil : "🔔 Push Aktiv"; 
}

let lastPushKey = "";
function checkPushTime() {
  if (myMuteUntil && Number(myMuteUntil) >= Number(dayKeyNow())) return;
  const h = new Date().getHours();
  const key = `${dayKeyNow()}_${h}`;
  if ([9, 12, 14, 16, 18].includes(h) && lastPushKey !== key) {
    if(Notification.permission === "granted") new Notification("Aufgaben Check!", { body: "Schau mal in die Liste, es gibt Arbeit." });
    lastPushKey = key;
  }
}

/* --- 4. STREAMS --- */
function initStreams() {
  // Tags / Bereiche
  onSnapshot(query(collection(db, "tags"), orderBy("tagId")), s => {
    tags = s.docs.map(d => ({id:d.id, ...d.data()}));
    renderTagList();
    if($("planTagSel")) $("planTagSel").innerHTML = `<option value="">-- Bereich --</option>` + tags.map(t=>`<option value="${t.tagKey}">${t.tagId}</option>`).join("");
    if(isAdmin) renderAdminTags();
  });

  // Grunddesinfektion Kategorien
  onSnapshot(collection(db, "hygiene_cats"), s => {
    hygieneCats = s.docs.map(d => ({id:d.id, ...d.data()}));
    renderHygieneUserView();
    if(isAdmin) renderHygieneAdmin();
  });

  // Fahrten (72h)
  onSnapshot(query(collection(db, "rides"), orderBy("createdAt", "desc"), limit(50)), s => {
    $("ridesList").innerHTML = s.docs.map(d => {
      const r = d.data();
      return `<div class="item"><div class="main"><b>🚗 ${esc(r.name)}</b><br><small>Einsatz: ${esc(r.einsatz)}</small></div>${isAdmin?`<button class="btn danger" onclick="delRide('${d.id}')">X</button>`:''}</div>`;
    }).join("");
  });
}

window.delRide = async (id) => { if(confirm("Löschen?")) await deleteDoc(doc(db, "rides", id)); };

/* --- 5. AUFGABEN LOGIK --- */
function renderTagList() {
  const q = n($("tagSearch").value).toLowerCase();
  $("tagList").innerHTML = tags.filter(t=>t.tagId.toLowerCase().includes(q)).map(t=>`<div class="item"><span>🏷️ ${t.tagId}</span><button class="btn ghost" onclick="openTag('${t.tagKey}','${t.tagId}')">Öffnen</button></div>`).join("");
}

window.openTag = (key, id) => {
  currentTagKey = key; $("openTagTitle").textContent = `Tag: ${id}`;
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("tagKey", "==", key), where("type", "==", "task")), s => {
    $("taskList").innerHTML = s.docs.map(d => {
      const t = d.data(); if(!isAdmin && t.status !== "open") return "";
      return `<div class="item"><b>${t.status==='open'?'⏳':'✅'} ${esc(t.text)}</b><button class="btn ghost" onclick="selectTask('${d.id}','${esc(t.text)}')">Wählen</button></div>`;
    }).join("");
  });
};

window.selectTask = (id, txt) => { selectedTaskId = id; $("taskHint").textContent = "Gewählt: " + txt; };

$("markSelectedDoneBtn").onclick = async () => {
  const who = Array.from($("doneBySel").selectedOptions).map(o=>o.value);
  if(selectedTaskId && who.length) { 
    await updateDoc(doc(db, "daily_tasks", selectedTaskId), { status: "done", doneBy: who, doneAt: stamp() }); 
    selectedTaskId = ""; $("taskHint").textContent = ""; 
  }
};

/* --- 6. GRUNDDESINFEKTION MIT CHECKLISTEN --- */
function renderHygieneUserView() {
  const cont = $("hygieneUserList"); if(!cont) return; cont.innerHTML = "";
  hygieneCats.forEach(cat => {
    const div = document.createElement("div");
    div.innerHTML = `<h3 style="margin-top:15px; border-bottom:1px solid #333">${esc(cat.title)}</h3><div id="hlist_${cat.id}" class="list"></div>`;
    cont.appendChild(div);
    onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("catId", "==", cat.id), where("type", "==", "hygiene")), s => {
      $(`hlist_${cat.id}`).innerHTML = s.docs.map(d => {
        if(d.data().status !== "open" && !isAdmin) return "";
        return `<div class="item"><span>${esc(d.data().text)}</span><button class="btn ghost" onclick="openHygCheck('${d.id}')">Bearbeiten</button></div>`;
      }).join("");
    });
  });
}

window.openHygCheck = async (id) => {
  activeCheckTaskId = id;
  const snap = await getDoc(doc(db, "daily_tasks", id));
  const data = snap.data();
  $("modalTitle").textContent = data.text;
  const cont = $("modalSubtasks"); cont.innerHTML = "";
  if (!data.subtasks || data.subtasks.length === 0) {
     if(confirm("Keine Checkliste. Als erledigt markieren?")) {
        await updateDoc(doc(db, "daily_tasks", id), { status: "done", doneBy: [meName], doneAt: stamp() });
     }
     return;
  }
  data.subtasks.forEach((sub, i) => {
    cont.innerHTML += `<label class="item"><input type="checkbox" class="sub-check"> <span>${esc(sub)}</span></label>`;
  });
  show($("checkModal"), true);
};

$("saveCheckBtn").onclick = async () => {
  if (Array.from(document.querySelectorAll(".sub-check")).every(c => c.checked)) {
    await updateDoc(doc(db, "daily_tasks", activeCheckTaskId), { status: "done", doneBy: [meName], doneAt: stamp() });
    show($("checkModal"), false);
  } else alert("Bitte alle Punkte abhaken!");
};
$("closeModalBtn").onclick = () => show($("checkModal"), false);

/* --- 7. ADMIN LOGIK --- */
function initAdminLogic() {
  // Endkontrolle
  onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("status", "==", "done")), s => {
    const tH = [], hH = [];
    s.docs.forEach(d => {
      const t = d.data();
      const html = `<div class="item"><div><b>${esc(t.text)}</b><br><small>${t.doneBy.join(", ")}</small></div><div><button class="btn danger" onclick="rejectTask('${d.id}')" style="margin-right:5px">❌</button><button class="btn ghost" onclick="finalCheck('${d.id}','${t.type}')">OK</button></div></div>`;
      if(t.type === "hygiene") hH.push(html); else tH.push(html);
    });
    $("finalListTasks").innerHTML = tH.join(""); $("finalListHygiene").innerHTML = hH.join("");
  });

  // Vorlagen Liste
  onSnapshot(collection(db, "hygiene_templates"), s => {
    $("hygieneTemplateList").innerHTML = s.docs.map(d => `<div class="item"><span>${esc(d.data().text)} (${d.data().catTitle || 'Unbekannt'})</span><button class="btn danger" onclick="delHygTpl('${d.id}')">X</button></div>`).join("");
  });
}

window.rejectTask = async (id) => { if(confirm("Aufgabe zurückweisen?")) await updateDoc(doc(db, "daily_tasks", id), { status: "open", doneBy: [], doneAt: null }); };
window.finalCheck = async (id, type) => {
  const dRef = doc(db, "daily_tasks", id); const snap = await getDoc(dRef); await updateDoc(dRef, { status: "final" });
  if(type !== "hygiene") {
    for(const name of snap.data().doneBy) {
      const pRef = doc(db, "points_tasks", keyOfName(name)); const pS = await getDoc(pRef);
      await setDoc(pRef, { points: (pS.exists()?pS.data().points:0)+1 }, { merge: true });
    }
  }
};

/* Admin Setup Actions */
$("hygieneCatAddBtn").onclick = async () => { const t = n($("hygieneCatInp").value); if(t) await addDoc(collection(db, "hygiene_cats"), { title: t }); $("hygieneCatInp").value = ""; };
function renderHygieneAdmin() { $("hygieneCatList").innerHTML = hygieneCats.map(c => `<div class="item"><span>${esc(c.title)}</span><button class="btn danger" onclick="delHygCat('${c.id}')">X</button></div>`).join(""); $("hygieneItemCatSel").innerHTML = hygieneCats.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join(""); }
window.delHygCat = (id) => deleteDoc(doc(db, "hygiene_cats", id));
window.delHygTpl = (id) => deleteDoc(doc(db, "hygiene_templates", id));

$("hygieneItemAddBtn").onclick = async () => {
  const catId = $("hygieneItemCatSel").value; const text = n($("hygieneItemInp").value);
  const subs = n($("hygieneSubtasksInp").value).split('\n').filter(line => line.trim() !== "");
  const catTitle = hygieneCats.find(c=>c.id===catId)?.title || "";
  if (catId && text) { await addDoc(collection(db, "hygiene_templates"), { catId, catTitle, text, subtasks: subs, type: "hygiene" }); $("hygieneItemInp").value = ""; $("hygieneSubtasksInp").value = ""; }
};

/* Wochenplan Admin */
$("planAddBtn").onclick = async () => {
  const txt = n($("planTaskInp").value), wd = Number($("planWeekdaySel").value), tag = $("planTagSel").value;
  if (txt && tag) { await addDoc(collection(db, "weekly_tasks"), { text: txt, tagKey: tag, weekday: wd, active: true, type: "task" }); $("planTaskInp").value = ""; }
};

/* Personal & Tags Admin */
$("empAddBtn").onclick = async () => { const v = n($("empAdd").value); if(v) await setDoc(doc(db, "employees", keyOfName(v)), { name: v, passHash: "" }); $("empAdd").value = ""; };
$("tagAddBtn").onclick = async () => { const v = n($("tagAdd").value); if(v) await setDoc(doc(db, "tags", keyOfName(v)), { tagId: v, tagKey: keyOfName(v) }); $("tagAdd").value = ""; };
$("adminUidAddBtn").onclick = async () => { const v = n($("adminUidAdd").value); if(v) await setDoc(doc(db, "admins_by_name", keyOfName(v)), { enabled: true }); $("adminUidAdd").value = ""; };

/* --- 8. GENERATOR --- */
async function generate(dateKey) {
  const batch = writeBatch(db); const wd = getWeekday();
  const wS = await getDocs(query(collection(db, "weekly_tasks"), where("weekday", "==", wd)));
  wS.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey, status: "open", doneBy: [], createdAt: serverTimestamp() }));
  const hS = await getDocs(collection(db, "hygiene_templates"));
  hS.forEach(d => batch.set(doc(collection(db, "daily_tasks")), { ...d.data(), dateKey, status: "open", doneBy: [], createdAt: serverTimestamp() }));
  await batch.commit();
}

async function runDayChange() {
  const today = dayKeyNow(); const mS = await getDoc(doc(db, "meta", "day_state"));
  if (!mS.exists() || mS.data().lastDayKey !== today) {
    await generate(today); await setDoc(doc(db, "meta", "day_state"), { lastDayKey: today }, { merge: true });
  }
}

if($("regenTestBtn")) $("regenTestBtn").onclick = async () => {
  if(!confirm("Tag neu generieren?")) return;
  const today = dayKeyNow(); const ex = await getDocs(query(collection(db, "daily_tasks"), where("dateKey", "==", today)));
  const b = writeBatch(db); ex.forEach(d => b.delete(d.ref)); await b.commit();
  await generate(today); alert("Neu generiert!");
};

/* --- UI TAB LOGIC --- */
document.querySelectorAll(".tabbtn").forEach(b => b.onclick = () => { document.querySelectorAll(".tab").forEach(t => show(t, false)); show($(b.dataset.tab), true); document.querySelectorAll(".tabbtn").forEach(x => x.classList.remove("active")); b.classList.add("active"); });
document.querySelectorAll(".subtabbtn").forEach(b => b.onclick = () => { document.querySelectorAll(".subtab").forEach(s => show(s, false)); show($(b.dataset.subtab), true); document.querySelectorAll(".subtabbtn").forEach(x => x.classList.remove("active")); b.classList.add("active"); });
if ($("tagSearch")) $("tagSearch").oninput = renderTagList;
$("logoutBtn").onclick = () => { localStorage.clear(); signOut(auth).then(()=>location.reload()); };
$("reloadBtn").onclick = () => location.reload();
