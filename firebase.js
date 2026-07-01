// ============================================
// firebase.js — Firebase initialization + helpers
// AN SPORTS LIVE TV
// ============================================
// Uses Firebase v9 compat SDK (loaded via CDN in HTML)

// ---- REPLACE THESE WITH YOUR OWN FIREBASE PROJECT CONFIG ----
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
// -------------------------------------------------------------

// Initialize (guard against double init)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// Exposed globally so app.js / admin inline scripts can use them
const auth = firebase.auth();
const db = firebase.database();
let storage = null;
try { storage = firebase.storage(); } catch (e) { storage = null; }

// Database references
const DB = {
  channels: db.ref("channels"),
  announcements: db.ref("announcements"),
  stats: db.ref("stats"),
  views: db.ref("views")
};

// Admin email allowed to manage content
const ADMIN_EMAIL = "nahidkhan7504@gmail.com";

// Helper: safe string
function safe(v, fallback = "") {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

// Helper: generate a stable id
function genId() {
  return DB.channels.push().key;
}

// Make available on window
window.AN = {
  auth, db, storage, DB, ADMIN_EMAIL, safe, genId
};