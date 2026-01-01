// Block Coder - main client
(() => {
  // --- SETTINGS & BLOCK CATALOG
  const TICK_MS = 1000; // how often the program runs (1s)
  // block catalog: id, name, price, production (per tick) and description
  const CATALOG = [
    { id: 'add1', name: 'Add +1', price: 5, prod: 1, desc: 'Adds +1 currency when executed' },
    { id: 'add5', name: 'Add +5', price: 40, prod: 5, desc: 'Adds +5' },
    { id: 'add10', name: 'Add +10', price: 120, prod: 10, desc: 'Adds +10' },
    { id: 'auto2', name: 'Auto +2', price: 250, prod: 2, desc: 'Small steady income per tick' },
    { id: 'mult2', name: 'Double', price: 500, prod: 0, desc: 'Doubles the value produced by previous Add block this tick' }
  ];

  // --- STATE (kept in localStorage; synced to server when logged in)
  const LS_KEY = 'block-coder-state-v1';
  let state = {
    currency: 10,
    owned: { add1: 1 }, // owned counts
    sequence: [], // array of block IDs (program)
    lastTick: Date.now()
  };

  let token = localStorage.getItem('bc_token') || null;
  let username = null;
  const apiBase = ''; // same origin

  // --- DOM
  const el = id => document.getElementById(id);
  const currencyEl = el('currency');
  const perTickEl = el('per-tick');
  const shopListEl = el('shop-list');
  const ownedListEl = el('owned-list');
  const sequenceEl = el('sequence');
  const leaderboardEl = el('leaderboard');
  const saveStatusEl = el('save-status');

  const btnSave = el('btn-save');
  const btnRegister = el('btn-register');
  const btnLogin = el('btn-login');
  const btnLogout = el('btn-logout');

  // --- STORAGE
  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          state = Object.assign({}, state, parsed);
        }
      }
    } catch (e) { console.warn('loadLocal error', e); }
  }
  function saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) { console.warn('saveLocal error', e); }
  }

  // --- UI RENDER
  function renderShop() {
    shopListEl.innerHTML = '';
    CATALOG.forEach(b => {
      const div = document.createElement('div');
      div.className = 'block';
      div.innerHTML = `<div>
        <div><strong>${b.name}</strong></div>
        <div class="meta">${b.desc}</div>
      </div>
      <div>
        <div class="meta">${b.price} ⌾</div>
        <button data-id="${b.id}">Buy</button>
      </div>`;
      shopListEl.appendChild(div);
      const btn = div.querySelector('button');
      btn.addEventListener('click', () => buyBlock(b.id));
    });
  }

  function renderOwned() {
    ownedListEl.innerHTML = '';
    const keys = Object.keys(state.owned);
    if (keys.length === 0) ownedListEl.innerHTML = '<div class="hint">No blocks owned yet</div>';
    keys.forEach(id => {
      const count = state.owned[id] || 0;
      const b = CATALOG.find(c => c.id === id) || { name: id, prod: 0 };
      const div = document.createElement('div');
      div.className = 'block';
      div.innerHTML = `<div><strong>${b.name}</strong><div class="meta">Owned: ${count}</div></div><div><button data-id="${id}">Use</button></div>`;
      ownedListEl.appendChild(div);
      div.querySelector('button').addEventListener('click', () => appendToSequence(id));
    });
  }

  // simple drag-reorder for sequence
  function makeSeqDraggable(itemEl) {
    itemEl.draggable = true;
    itemEl.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', itemEl.dataset.index);
      itemEl.classList.add('dragging');
    });
    itemEl.addEventListener('dragend', () => itemEl.classList.remove('dragging'));
  }

  function renderSequence() {
    sequenceEl.innerHTML = '';
    if (state.sequence.length === 0) sequenceEl.innerHTML = '<div class="hint">Program is empty — append owned blocks to run them each tick.</div>';
    state.sequence.forEach((id, i) => {
      const b = CATALOG.find(c => c.id === id) || { name: id };
      const div = document.createElement('div');
      div.className = 'seq-item';
      div.dataset.index = String(i);
      div.innerHTML = `<div>${i+1}. <strong>${b.name}</strong></div><div><button data-i="${i}" class="btn-remove">Remove</button></div>`;
      sequenceEl.appendChild(div);
      div.querySelector('.btn-remove').addEventListener('click', () => {
        state.sequence.splice(i,1);
        saveAndRender();
      });
      makeSeqDraggable(div);
    });

    sequenceEl.addEventListener('dragover', e => {
      e.preventDefault();
      const dragging = sequenceEl.querySelector('.dragging');
      if (!dragging) return;
      const after = Array.from(sequenceEl.querySelectorAll('.seq-item:not(.dragging)')).find(node => {
        const rect = node.getBoundingClientRect();
        return e.clientY < rect.top + rect.height/2;
      });
      if (after) sequenceEl.insertBefore(dragging, after);
      else sequenceEl.appendChild(dragging);
    });

    // when drop happens, rebuild state.sequence from DOM order
    sequenceEl.addEventListener('drop', e => {
      e.preventDefault();
      const items = Array.from(sequenceEl.querySelectorAll('.seq-item'));
      const newSeq = items.map(it => state.sequence[Number(it.dataset.index)]);
      state.sequence = newSeq;
      saveAndRender();
    });
  }

  function renderStatus() {
    currencyEl.textContent = Math.floor(state.currency);
    perTickEl.textContent = Math.floor(calculatePerTick());
  }

  // --- SHOP & PROGRAM ACTIONS
  function buyBlock(id) {
    const b = CATALOG.find(c => c.id === id);
    if (!b) return;
    if (state.currency < b.price) {
      alert('Not enough currency');
      return;
    }
    state.currency -= b.price;
    state.owned[id] = (state.owned[id] || 0) + 1;
    saveAndRender();
  }

  function appendToSequence(id) {
    if ((state.owned[id] || 0) <= 0) {
      alert('You do not own that block.');
      return;
    }
    state.sequence.push(id);
    saveAndRender();
  }

  function clearProgram() {
    state.sequence = [];
    saveAndRender();
  }

  // --- PROGRAM EXECUTION
  // Execution model: iterate sequence left->right; "mult2" doubles lastAdded this tick
  function runSequenceTick() {
    let addedThisTick = 0;
    for (let i = 0; i < state.sequence.length; i++) {
      const id = state.sequence[i];
      const b = CATALOG.find(c => c.id === id);
      if (!b) continue;
      if (id === 'mult2') {
        // doubles the last additive (applies only to addedThisTick)
        addedThisTick = addedThisTick * 2;
      } else {
        addedThisTick += (b.prod || 0);
      }
    }
    // plus passive income from owned-only auto blocks that aren't in sequence
    CATALOG.forEach(c => {
      if ((state.owned[c.id] || 0) > 0 && c.id.startsWith('auto')) {
        // each owned auto block produces its prod per owned count (they produce regardless)
        addedThisTick += (c.prod || 0) * (state.owned[c.id] || 0);
      }
    });

    state.currency += addedThisTick;
    state.lastTick = Date.now();
    saveLocal();
    renderStatus();
  }

  function calculatePerTick() {
    // estimate per tick from sequence + autos
    let added = 0;
    let temp = 0;
    for (let i = 0; i < state.sequence.length; i++) {
      const id = state.sequence[i];
      const b = CATALOG.find(c => c.id === id);
      if (!b) continue;
      if (id === 'mult2') {
        temp = temp * 2;
      } else {
        temp += (b.prod || 0);
      }
    }
    added += temp;
    CATALOG.forEach(c => {
      if ((state.owned[c.id] || 0) > 0 && c.id.startsWith('auto')) {
        added += (c.prod || 0) * (state.owned[c.id] || 0);
      }
    });
    return added;
  }

  // --- SAVE / SYNC
  let autoSaveTimer = null;
  function saveAndRender() {
    saveLocal();
    renderAll();
  }
  async function saveToServerManual() {
    if (!token) { saveStatusEl.textContent = 'Not logged in'; return; }
    try {
      saveStatusEl.textContent = 'Saving...';
      const r = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ state })
      });
      const j = await r.json();
      if (j.ok) {
        saveStatusEl.textContent = 'Saved';
        // refresh leaderboard if returned
        if (j.leaderboard) renderLeaderboard(j.leaderboard);
      } else {
        saveStatusEl.textContent = 'Save failed';
      }
    } catch (e) {
      console.warn('saveToServer error', e);
      saveStatusEl.textContent = 'Save error';
    }
    setTimeout(()=> saveStatusEl.textContent = '', 2000);
  }

  async function tryAutoSync() {
    if (!token) return;
    try {
      const r = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ state })
      });
      const j = await r.json();
      if (j.ok && j.leaderboard) renderLeaderboard(j.leaderboard);
    } catch (e) {
      // ignore network errors for auto-sync
    }
  }

  // --- AUTH
  async function registerUser() {
    const u = document.getElementById('reg-username').value.trim();
    const p = document.getElementById('reg-password').value;
    if (!u || !p) return alert('enter username & password');
    try {
      const r = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: u, password: p }) });
      const j = await r.json();
      if (j.ok) alert('registered — now log in');
      else alert(j.error || 'register failed');
    } catch (e) {
      console.error(e); alert('network error');
    }
  }

  async function loginUser() {
    const u = document.getElementById('login-username').value.trim();
    const p = document.getElementById('login-password').value;
    if (!u || !p) return alert('enter username & password');
    try {
      const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: u, password: p }) });
      const j = await r.json();
      if (j.token) {
        token = j.token;
        username = j.username || u;
        localStorage.setItem('bc_token', token);
        // merge server state: if server returned state use that (simpler)
        if (j.state) {
          state = Object.assign({}, state, j.state);
        }
        setLoggedInUI(username);
        saveLocal();
        loadLeaderboardFromServer();
      } else {
        alert(j.error || 'login failed');
      }
    } catch (e) {
      console.error(e); alert('network error');
    }
  }

  function logoutUser() {
    token = null;
    username = null;
    localStorage.removeItem('bc_token');
    setLoggedOutUI();
  }

  function setLoggedInUI(name) {
    document.getElementById('auth-forms').style.display = 'none';
    document.getElementById('logged-in').style.display = 'block';
    document.getElementById('who').textContent = name;
  }
  function setLoggedOutUI() {
    document.getElementById('auth-forms').style.display = 'block';
    document.getElementById('logged-in').style.display = 'none';
    document.getElementById('who').textContent = '';
  }

  // --- LEADERBOARD
  async function loadLeaderboardFromServer() {
    try {
      const r = await fetch('/api/leaderboard');
      const j = await r.json();
      if (j.leaderboard) renderLeaderboard(j.leaderboard);
    } catch (e) { console.warn('leaderboard error', e); }
  }
  function renderLeaderboard(list) {
    leaderboardEl.innerHTML = '';
    list.forEach(i => {
      const li = document.createElement('li');
      li.textContent = `${i.username} — ${Math.floor(i.currency)} ⌾`;
      leaderboardEl.appendChild(li);
    });
  }

  // --- INIT + TICK
  function renderAll() {
    renderShop();
    renderOwned();
    renderSequence();
    renderStatus();
  }

  function startLoop() {
    setInterval(() => {
      runSequenceTick();
      // auto-save local
      saveLocal();
      // auto-sync occasionally
      if (Math.random() < 0.25) tryAutoSync();
    }, TICK_MS);
    // autosave to server periodically
    autoSaveTimer = setInterval(() => {
      if (token) tryAutoSync();
    }, 15000);
  }

  // --- WIRING
  // buttons
  btnSave.addEventListener('click', saveToServerManual);
  btnRegister.addEventListener('click', registerUser);
  btnLogin.addEventListener('click', loginUser);
  btnLogout && btnLogout.addEventListener('click', logoutUser);
  el('btn-clear-program').addEventListener('click', () => { if (confirm('Clear program?')) { clearProgram(); } });

  // initial load
  loadLocal();
  // if token exists, try to restore username from JWT (quick decode)
  try {
    const tok = localStorage.getItem('bc_token');
    if (tok) {
      const parts = tok.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]));
        if (payload.username) {
          token = tok;
          username = payload.username;
          setLoggedInUI(username);
        }
      }
    }
  } catch (e) { /* ignore */ }

  renderAll();
  loadLeaderboardFromServer();
  startLoop();
})();
