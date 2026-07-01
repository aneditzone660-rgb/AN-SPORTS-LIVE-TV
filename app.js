// ============================================
// app.js — Main application logic
// AN SPORTS LIVE TV
// ============================================

const { auth, DB, safe } = window.AN;

let ALL_CHANNELS = [];      // array of channel objects
let currentCategory = "All";
let currentSearch = "";
let viewMode = "home";       // home | category | player
let hls = null;
let currentStreamUrl = "";
let retryCount = 0;
const MAX_RETRY = 5;

// LocalStorage favorites
function getFavs() {
  try { return JSON.parse(localStorage.getItem("an_favs") || "[]"); }
  catch (e) { return []; }
}
function setFavs(arr) {
  localStorage.setItem("an_favs", JSON.stringify(arr));
}
function isFav(id) { return getFavs().includes(id); }
function toggleFav(id) {
  let f = getFavs();
  if (f.includes(id)) f = f.filter(x => x !== id);
  else f.push(id);
  setFavs(f);
  render();
}

// ---------- VISITOR ANALYTICS ----------
function trackVisit() {
  const today = new Date().toISOString().slice(0, 10);
  // Total visitors
  DB.stats.child("totalVisitors").transaction(v => (v || 0) + 1);
  // Today's visitors
  DB.stats.child("daily").child(today).transaction(v => (v || 0) + 1);
  // Active user (presence)
  const myRef = DB.stats.child("active").push(true);
  myRef.onDisconnect().remove();
  window.addEventListener("beforeunload", () => myRef.remove());
}

function trackView(channelId, name) {
  DB.views.child(channelId).transaction(o => {
    if (!o) return { name: name, count: 1 };
    o.count = (o.count || 0) + 1;
    o.name = name;
    return o;
  });
  DB.stats.child("totalViews").transaction(v => (v || 0) + 1);
}

// ---------- REALTIME CHANNEL SYNC ----------
function listenChannels() {
  DB.channels.on("value", snap => {
    const data = snap.val() || {};
    ALL_CHANNELS = Object.keys(data).map(k => {
      const c = data[k] || {};
      return {
        id: k,
        name: safe(c.name, "Unknown"),
        logo: safe(c.logo),
        category: safe(c.category, "Sports"),
        description: safe(c.description),
        country: safe(c.country),
        language: safe(c.language),
        tags: safe(c.tags),
        url: safe(c.url),
        featured: !!c.featured,
        live: c.live !== false,
        enabled: c.enabled !== false
      };
    }).filter(c => c.enabled); // hide disabled
    render();
  }, err => {
    console.error("Channel sync error:", err);
    showToast("Sync error: check Firebase rules");
  });
}

// ---------- ANNOUNCEMENTS ----------
function listenAnnouncements() {
  DB.announcements.on("value", snap => {
    const data = snap.val() || {};
    const msgs = Object.values(data)
      .filter(a => a && a.active !== false)
      .map(a => safe(a.text));
    const wrap = document.getElementById("tickerWrap");
    const ticker = document.getElementById("ticker");
    if (msgs.length) {
      ticker.textContent = msgs.join("    •    ");
      wrap.style.display = "block";
    } else {
      wrap.style.display = "none";
    }
  });
}

// ---------- RENDER ----------
function matchSearch(c) {
  if (!currentSearch) return true;
  const q = currentSearch.toLowerCase();
  return c.name.toLowerCase().includes(q) ||
         c.category.toLowerCase().includes(q) ||
         c.country.toLowerCase().includes(q) ||
         c.tags.toLowerCase().includes(q);
}

function render() {
  const grid = document.getElementById("channelGrid");
  const empty = document.getElementById("emptyState");
  const featuredSection = document.getElementById("featuredSection");
  const featuredRow = document.getElementById("featuredRow");
  const gridTitle = document.getElementById("gridTitle");

  // Featured (only on home, no search)
  const featured = ALL_CHANNELS.filter(c => c.featured && matchSearch(c));
  if (currentCategory === "All" && !currentSearch && featured.length) {
    featuredSection.style.display = "block";
    featuredRow.innerHTML = featured.map(cardHTML).join("");
  } else {
    featuredSection.style.display = "none";
  }

  // Main list
  let list = ALL_CHANNELS.filter(matchSearch);
  if (currentCategory !== "All") {
    if (currentCategory === "Favorites") {
      const favs = getFavs();
      list = list.filter(c => favs.includes(c.id));
      gridTitle.textContent = "Favorites";
    } else {
      list = list.filter(c => c.category === currentCategory);
      gridTitle.textContent = currentCategory + " Channels";
    }
  } else {
    gridTitle.textContent = currentSearch ? "Search Results" : "All Channels";
  }

  grid.innerHTML = list.map(cardHTML).join("");
  empty.style.display = list.length ? "none" : "block";

  // Bind card clicks
  document.querySelectorAll("[data-play]").forEach(el => {
    el.onclick = () => {
      const c = ALL_CHANNELS.find(x => x.id === el.dataset.play);
      if (c) openPlayer(c);
    };
  });
  document.querySelectorAll("[data-fav]").forEach(el => {
    el.onclick = (e) => { e.stopPropagation(); toggleFav(el.dataset.fav); };
  });
}

function cardHTML(c) {
  const logo = c.logo || "https://dummyimage.com/200x200/12231a/00e676&text=" + encodeURIComponent(c.name.charAt(0));
  const favClass = isFav(c.id) ? "faved" : "";
  const liveBadge = c.live ? '<span class="live-dot">LIVE</span>' : "";
  return `
    <div class="card" data-play="${c.id}">
      <div class="card-thumb">
        <img src="${logo}" alt="${c.name}" loading="lazy"
             onerror="this.src='https://dummyimage.com/200x200/12231a/00e676&text=TV'"/>
        ${liveBadge}
        <button class="fav-star ${favClass}" data-fav="${c.id}">★</button>
      </div>
      <div class="card-body">
        <div class="card-name">${c.name}</div>
        <div class="card-meta">${c.category}${c.country ? " • " + c.country : ""}</div>
      </div>
    </div>`;
}

function showToast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2500);
}

// ---------- PLAYER ----------
function openPlayer(c) {
  if (!c.url) { showToast("No stream URL"); return; }
  viewMode = "player";
  history.pushState({ view: "player" }, "");
  document.getElementById("playerTitle").textContent = c.name;
  document.getElementById("playerModal").classList.add("open");
  currentStreamUrl = c.url;
  retryCount = 0;
  trackView(c.id, c.name);
  loadStream(c.url);
}

function loadStream(url) {
  const video = document.getElementById("video");
  const loader = document.getElementById("videoLoader");
  const status = document.getElementById("playerStatus");
  loader.style.display = "flex";
  status.textContent = "Connecting...";

  destroyHls();

  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({
      maxBufferLength: 30,
      manifestLoadingMaxRetry: 4,
      levelLoadingMaxRetry: 4,
      fragLoadingMaxRetry: 6
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      loader.style.display = "none";
      status.textContent = "Playing";
      retryCount = 0;
      video.play().catch(() => {});
    });
    hls.on(Hls.Events.ERROR, (evt, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            status.textContent = "Network error, reconnecting...";
            autoReconnect(url);
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            status.textContent = "Media error, recovering...";
            try { hls.recoverMediaError(); } catch (e) { autoReconnect(url); }
            break;
          default:
            autoReconnect(url);
        }
      }
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    // Native HLS (Safari / iOS)
    video.src = url;
    video.addEventListener("loadedmetadata", () => {
      loader.style.display = "none";
      status.textContent = "Playing";
      video.play().catch(() => {});
    }, { once: true });
    video.addEventListener("error", () => autoReconnect(url), { once: true });
  } else {
    status.textContent = "HLS not supported on this device";
    loader.style.display = "none";
  }
}

function autoReconnect(url) {
  if (viewMode !== "player") return;
  if (retryCount >= MAX_RETRY) {
    document.getElementById("playerStatus").textContent = "Stream unavailable. Tap ⟳ to retry.";
    document.getElementById("videoLoader").style.display = "none";
    return;
  }
  retryCount++;
  document.getElementById("playerStatus").textContent =
    `Reconnecting (${retryCount}/${MAX_RETRY})...`;
  setTimeout(() => { if (viewMode === "player") loadStream(url); }, 2000);
}

function destroyHls() {
  if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
  const v = document.getElementById("video");
  try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {}
}

function closePlayer() {
  destroyHls();
  document.getElementById("playerModal").classList.remove("open");
  // exit fullscreen / unlock orientation
  if (document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch(e){}
  viewMode = currentCategory === "All" ? "home" : "category";
}

// Player controls
function bindPlayerControls() {
  const video = document.getElementById("video");
  document.getElementById("btnPlay").onclick = () => video.play().catch(()=>{});
  document.getElementById("btnPause").onclick = () => video.pause();
  document.getElementById("btnStop").onclick = () => { video.pause(); video.currentTime = 0; };
  document.getElementById("btnMute").onclick = (e) => {
    video.muted = !video.muted;
    e.target.textContent = video.muted ? "🔇" : "🔊";
  };
  document.getElementById("volume").oninput = (e) => {
    video.volume = parseFloat(e.target.value);
    video.muted = video.volume === 0;
  };
  document.getElementById("btnRetry").onclick = () => {
    retryCount = 0;
    if (currentStreamUrl) loadStream(currentStreamUrl);
  };
  document.getElementById("btnFull").onclick = toggleFullscreen;
  document.getElementById("closePlayer").onclick = () => history.back();
}

function toggleFullscreen() {
  const wrap = document.getElementById("videoWrap");
  if (!document.fullscreenElement) {
    const req = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
    if (req) req.call(wrap).then(lockLandscape).catch(()=>{});
    else lockLandscape();
  } else {
    document.exitFullscreen().catch(()=>{});
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch(e){}
  }
}
function lockLandscape() {
  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock("landscape").catch(()=>{});
    }
  } catch (e) {}
}

// ---------- BACK BUTTON HANDLING ----------
function bindBackButton() {
  // Seed initial state
  history.replaceState({ view: "home" }, "");
  window.addEventListener("popstate", () => {
    if (viewMode === "player") {
      closePlayer();
      return;
    }
    if (viewMode === "category") {
      goHome();
      // re-push so we stay inside app
      history.pushState({ view: "home" }, "");
      return;
    }
    // home -> exit confirm
    showExitConfirm();
    history.pushState({ view: "home" }, "");
  });
}

function showExitConfirm() {
  document.getElementById("exitModal").classList.add("open");
}
function bindExit() {
  document.getElementById("exitNo").onclick = () =>
    document.getElementById("exitModal").classList.remove("open");
  document.getElementById("exitYes").onclick = () => {
    document.getElementById("exitModal").classList.remove("open");
    // Try to close; browsers may block window.close on PWAs
    window.history.go(-(window.history.length - 1));
    try { window.close(); } catch (e) {}
  };
}

function goHome() {
  currentCategory = "All";
  currentSearch = "";
  document.getElementById("searchInput").value = "";
  viewMode = "home";
  document.querySelectorAll(".chip").forEach(ch =>
    ch.classList.toggle("active", ch.dataset.cat === "All"));
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- CATEGORY + SEARCH BIND ----------
function bindUI() {
  document.querySelectorAll(".chip").forEach(chip => {
    chip.onclick = () => {
      document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      currentCategory = chip.dataset.cat;
      viewMode = currentCategory === "All" ? "home" : "category";
      if (viewMode === "category") history.pushState({ view: "category" }, "");
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  });

  let searchTimer;
  document.getElementById("searchInput").oninput = (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentSearch = e.target.value.trim();
      render();
    }, 200);
  };

  document.getElementById("homeBtn").onclick = goHome;

  document.getElementById("favBtn").onclick = () => {
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    currentCategory = "Favorites";
    viewMode = "category";
    history.pushState({ view: "category" }, "");
    render();
  };
}

// ---------- INIT ----------
function init() {
  bindUI();
  bindPlayerControls();
  bindBackButton();
  bindExit();
  listenChannels();
  listenAnnouncements();
  trackVisit();

  setTimeout(() => {
    const s = document.getElementById("splash");
    if (s) s.classList.add("hide");
  }, 1200);
}

document.addEventListener("DOMContentLoaded", init);
