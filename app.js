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
const db = initializeFirestore(app, { experimentalForceLongPolling: true });

/* ---------------- State ---------------- */
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

/* ---------------- 1. LOGIN & BENUTZER-LISTE ---------------- */

// SOFORT: Mitarbeiter laden (Unabhängig vom Login-Status)
function startEmployeeListener() {
    onSnapshot(query(collection(db, "employees"), orderBy("name")), (s) => {
        employees = s.docs.map(d => ({ key: d.id, ...d.data() }));
        const sel = $("nameSel");
        if (!sel) return;

        if (employees.length === 0) {
            sel.innerHTML = `<option value="">KEINE BENUTZER IN DB!</option>`;
        } else {
            const opts = employees.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join("");
            sel.innerHTML = `<option value="">Name wählen...</option>` + opts;
            
            // Auch andere Dropdowns füllen falls vorhanden
            if ($("doneBySel")) $("doneBySel").innerHTML = opts;
            if ($("rideNameSel")) $("rideNameSel").innerHTML = opts;
            if ($("empList")) renderAdminEmployees();
        }
    }, (err) => {
        console.error("Mitarbeiter-Fehler:", err);
        if ($("nameSel")) $("nameSel").innerHTML = `<option>Fehler: ${err.code}</option>`;
    });
}
startEmployeeListener();

// Login-Button Funktion
if ($("loginBtn")) $("loginBtn").onclick = async () => {
  const name = n($("nameSel")?.value);
  const pass = n($("passInp")?.value);

  if (!name) return alert("Bitte Namen wählen.");
  if (!pass) return alert("Bitte Passwort eingeben.");

  const key = keyOfName(name);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}:${pass}`))
    .then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, "0")).join(""));

  // 1. Anonym anmelden (falls noch nicht geschehen)
  if (!auth.currentUser) await signInAnonymously(auth);

  // 2. User-Check
  const eRef = doc(db, "employees", key);
  const eSnap = await getDoc(eRef);
  
  if (!eSnap.exists()) return alert("Benutzer existiert nicht in der Datenbank.");

  const userData = eSnap.data();
  if (!userData.passHash) {
    // Erster Login: Passwort setzen
    await updateDoc(eRef, { passHash: hash });
  } else if (userData.passHash !== hash) {
    return alert("Falsches Passwort.");
  }

  // 3. Erfolg: Speichern & Refresh
  localStorage.setItem("meName", name);
  localStorage.setItem("meKey", key);
  location.reload();
};

/* ---------------- 2. AUTH & ROLLEN ---------------- */
onAuthStateChanged(auth, async (user) => {
  if (user && meKey) {
    // UID mit Name verknüpfen
    await setDoc(doc(db, "users", user.uid), { name: meName, nameKey: meKey }, { merge: true });

    // Rollen prüfen
    const [sSnap, aSnap] = await Promise.all([
      getDoc(doc(db, "superadmins_by_name", meKey)),
      getDoc(doc(db, "admins_by_name", meKey))
    ]);
    isSuperAdmin = sSnap.exists() && sSnap.data()?.enabled === true;
    isAdmin = isSuperAdmin || (aSnap.exists() && aSnap.data()?.enabled === true);

    // UI Elemente schalten
    if ($("whoami")) $("whoami").textContent = `${meName}${isSuperAdmin ? " (Super)" : isAdmin ? " (Admin)" : ""}`;
    show($("adminTabBtn"), isAdmin);
    show($("adminArea"), isAdmin);
    show($("adminLock"), !isAdmin);
    show($("newDailyTaskBtn"), isAdmin);

    show($("loginView"), false);
    show($("appView"), true);
    
    initMainStreams();
    if (isAdmin) { initAdminLogic(); runDayChange(); }
  } else {
    show($("loginView"), true);
    show($("appView"), false);
  }
});

/* ---------------- 3. APP FUNKTIONEN (MAIN) ---------------- */
function initMainStreams() {
    // Tags laden
    onSnapshot(query(collection(db, "tags"), orderBy("tagId")), s => { 
      tags = s.docs.map(d => ({id: d.id, ...d.data()})); 
      renderTagList();
      if ($("planTagSel")) $("planTagSel").innerHTML = tags.map(t => `<option value="${t.tagKey}">${t.tagId}</option>`).join("");
    });

    // Fahrten (72h)
    onSnapshot(query(collection(db, "rides"), orderBy("createdAt", "desc"), limit(50)), s => {
      const cutoff = Date.now() - (72 * 60 * 60 * 1000);
      $("ridesList").innerHTML = s.docs.filter(d => (d.data().createdMs || 0) > cutoff).map(d => `
        <div class="item"><span>🚗 ${esc(d.data().name)}: ${esc(d.data().einsatz)}</span><small>${d.data().at}</small></div>
      `).join("");
    });
}

function renderTagList() {
    const s = n($("tagSearch")?.value).toLowerCase();
    $("tagList").innerHTML = tags.filter(t => t.tagId.toLowerCase().includes(s)).map(t => `
      <div class="item"><span>🏷️ ${esc(t.tagId)}</span><button class="btn ghost" onclick="openTag('${t.tagKey}', '${esc(t.tagId)}')">Öffnen</button></div>
    `).join("");
}

window.openTag = (tagKey, tagId) => {
    currentTagKey = tagKey;
    $("openTagTitle").textContent = `Tag: ${tagId}`;
    onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("tagKey", "==", tagKey)), s => {
      $("taskList").innerHTML = s.docs.map(d => `
        <div class="item">
          <div class="main"><b>${d.data().status === 'open' ? '⏳' : '✅'} ${esc(d.data().text)}</b></div>
          <button class="btn ghost" onclick="selectTask('${d.id}', '${esc(d.data().text)}')">Wählen</button>
        </div>
      `).join("");
    });
};

window.selectTask = (id, text) => { selectedTaskId = id; $("taskHint").textContent = `Gewählt: ${text}`; };

// Aufgabe erledigen
$("markSelectedDoneBtn").onclick = async () => {
    const who = Array.from($("doneBySel").selectedOptions).map(o => o.value);
    if (!selectedTaskId) return alert("Zuerst Aufgabe wählen!");
    if (who.length === 0) return alert("Wer hat es gemacht?");
    await updateDoc(doc(db, "daily_tasks", selectedTaskId), { status: "done", doneBy: who, doneAt: stamp(), updatedAt: serverTimestamp() });
    selectedTaskId = ""; $("taskHint").textContent = "";
};

// Fahrt eintragen
$("addRideBtn").onclick = async () => {
    const name = $("rideNameSel").value, einsatz = n($("rideEinsatz").value);
    if (!name || !einsatz) return alert("Name und Einsatz fehlen!");
    await addDoc(collection(db, "rides"), { name, einsatz, at: stamp(), createdMs: Date.now(), createdAt: serverTimestamp() });
    $("rideEinsatz").value = ""; $("rideInfo").textContent = "Gespeichert!";
    setTimeout(() => $("rideInfo").textContent = "", 2000);
};

/* ---------------- 4. ADMIN LOGIK ---------------- */
function initAdminLogic() {
    // Offene Abnahmen
    onSnapshot(query(collection(db, "daily_tasks"), where("dateKey", "==", dayKeyNow()), where("status", "==", "done")), s => {
      $("finalList").innerHTML = s.docs.map(d => `
        <div class="item"><span>✅ ${esc(d.data().text)} (${d.data().doneBy?.join(", ")})</span><button class="btn ghost" onclick="finalCheck('${d.id}')">Abnehmen</button></div>
      `).join("");
    });
    renderAdminTags();
}

window.finalCheck = async (id) => {
    const dRef = doc(db, "daily_tasks", id);
    const dSnap = await getDoc(dRef);
    await updateDoc(dRef, { status: "final", finalBy: meName });
    alert("Abgenommen!");
};

// Mitarbeiter hinzufügen
$("empAddBtn").onclick = async () => {
    const name = n($("empAdd").value);
    if (name) await setDoc(doc(db, "employees", keyOfName(name)), { name, passHash: "" });
    $("empAdd").value = "";
};

function renderAdminEmployees() {
    $("empList").innerHTML = employees.map(e => `
      <div class="item"><span>${esc(e.name)}</span><button class="btn ghost" onclick="resetPw('${e.key}')">PW Reset</button></div>
    `).join("");
}
window.resetPw = async (key) => { if(confirm("Passwort löschen?")) await updateDoc(doc(db, "employees", key), { passHash: "" }); };

// Wochenplan
$("planAddBtn").onclick = async () => {
    const text = n($("planTaskInp").value);
    const tagKey = $("planTagSel").value;
    const weekday = Number($("planWeekdaySel").value);
    if (text && tagKey) {
        await addDoc(collection(db, "weekly_tasks"), { text, tagKey, weekday, active: true });
        $("planTaskInp").value = "";
    }
};

/* ---------------- 5. TAGESWECHSEL (AUTOMATIK) ---------------- */
async function runDayChange() {
    const today = dayKeyNow();
    const mSnap = await getDoc(doc(db, "meta", "day_state"));
    if (mSnap.exists() && mSnap.data().lastDayKey === today) return;
    
    const wd = new Date().getDay() === 0 ? 7 : new Date().getDay();
    const wSnap = await getDocs(query(collection(db, "weekly_tasks"), where("weekday", "==", wd), where("active", "==", true)));
    const batch = writeBatch(db);
    wSnap.forEach(tDoc => {
        const newRef = doc(collection(db, "daily_tasks"));
        batch.set(newRef, { ...tDoc.data(), dateKey: today, status: "open", doneBy: [], createdAt: serverTimestamp() });
    });
    batch.set(doc(db, "meta", "day_state"), { lastDayKey: today }, { merge: true });
    await batch.commit();
}

/* ---------------- 6. NAVIGATION & TABS ---------------- */
$("logoutBtn").onclick = () => { localStorage.clear(); signOut(auth).then(() => location.reload()); };
$("reloadBtn").onclick = () => location.reload();

document.querySelectorAll(".tabbtn").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tab").forEach(t => show(t, false)); show($(b.dataset.tab), true);
  document.querySelectorAll(".tabbtn").forEach(x => x.classList.remove("active")); b.classList.add("active");
});

document.querySelectorAll(".subtabbtn").forEach(b => b.onclick = () => {
  document.querySelectorAll(".subtab").forEach(s => show(s, false)); show($(b.dataset.subtab), true);
  document.querySelectorAll(".subtabbtn").forEach(x => x.classList.remove("active")); b.classList.add("active");
});

if ($("tagSearch")) $("tagSearch").oninput = renderTagList;
