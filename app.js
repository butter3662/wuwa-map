/* 명조 지도 – 장치/보물상자 체크 (static, no build step) */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('브라우저 저장소에 쓸 수 없습니다'); } },
  };
  const K = { done: 'wuwa-ko:done', vis: 'wuwa-ko:visible', last: 'wuwa-ko:lastMap', opts: 'wuwa-ko:opts' };
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
  const isChest = (n) => /보물상자|조석의 유산/.test(n);
  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '');

  const state = {
    catalog: null, packId: null, pack: null, H: 0,
    done: new Set(LS.get(K.done, [])),
    visible: new Set(LS.get(K.vis, null) || []),
    visibleInit: LS.get(K.vis, null) !== null,
    opts: Object.assign({ hideDone: false, showAreas: true, quick: false }, LS.get(K.opts, {})),
    floor: '', search: '', focusId: null,
    map: null, markerLayer: null, areaLayer: null, floorLayer: null, scrim: null,
    lmarkers: new Map(), catTotal: [], catDone: [], searchIdx: null, packCache: new Map(),
  };

  /* ---------- helpers ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }
  const saveDone = () => LS.set(K.done, [...state.done]);
  const mtimes = LS.get('wuwa-ko:mtimes', {});
  function touchMap(id) { mtimes[id] = Date.now(); LS.set('wuwa-ko:mtimes', mtimes); Sync.schedule(id); }
  const saveVis = () => LS.set(K.vis, [...state.visible]);
  const saveOpts = () => LS.set(K.opts, state.opts);
  const ll = (x, y) => [state.H - y, x];
  const boundsLL = (b) => L.latLngBounds(ll(b.minX, b.maxY), ll(b.maxX, b.minY));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

  async function fetchPack(id) {
    if (state.packCache.has(id)) return state.packCache.get(id);
    const meta = state.catalog.maps[id];
    const res = await fetch(meta.file);
    if (!res.ok) throw new Error('지도 데이터를 불러오지 못했습니다: ' + meta.file);
    const p = await res.json();
    state.packCache.set(id, p);
    return p;
  }

  function parseHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    return { map: h.get('map'), m: h.get('m') };
  }
  function setHash(markerId) {
    const h = new URLSearchParams();
    h.set('map', state.packId);
    if (markerId) h.set('m', markerId);
    history.replaceState(null, '', '#' + h.toString());
  }

  /* ---------- packed tiles/icons (pk/*.webp chunks + pk/index.json) ---------- */
  const Pack = {
    index: null, files: new Map(), icons: {},
    async init() {
      const r = await fetch('pk/index.json'); this.index = await r.json();
      const ic = this.index.icons; const names = Object.keys(ic);
      if (names.length) {
        const buf = await this.file(ic[names[0]][0]);
        for (const n of names) { const [, off, len] = ic[n]; this.icons[n] = URL.createObjectURL(new Blob([buf.slice(off, off + len)], { type: 'image/webp' })); }
      }
    },
    file(name) {
      if (!this.files.has(name)) this.files.set(name, fetch('pk/' + name).then((r) => { if (!r.ok) throw new Error(name); return r.arrayBuffer(); }));
      return this.files.get(name);
    },
    has(dir, key) { const d = this.index.tiles[dir]; return !!(d && d[key]); },
    async tile(dir, key) {
      const e = this.index.tiles[dir][key];
      const buf = await this.file(e[0]);
      return URL.createObjectURL(new Blob([buf.slice(e[1], e[1] + e[2])], { type: 'image/webp' }));
    },
  };
  const iconSrc = (p) => (p ? Pack.icons[p.split('/').pop()] || '' : '');
  const tileDir = (src) => src.replace(/^tiles\//, '').replace(/\/\{x\}_\{y\}\.webp$/, '');
  const PackedLayer = L.GridLayer.extend({
    createTile(c, done) {
      const img = document.createElement('img');
      img.alt = ''; img.setAttribute('role', 'presentation');
      const key = `${c.x},${c.y}`; const dir = this.options.dir;
      if (!Pack.has(dir, key)) { img.src = BLANK; setTimeout(() => done(null, img), 0); return img; }
      Pack.tile(dir, key).then((u) => {
        img.onload = () => { done(null, img); URL.revokeObjectURL(u); };
        img.onerror = () => done(null, img);
        img.src = u;
      }, () => { img.src = BLANK; done(null, img); });
      return img;
    },
  });

  /* ---------- map / tiles ---------- */
  function tileLayer(t, pane, className) {
    return new PackedLayer({
      dir: tileDir(t.src), tileSize: t.tileSize, minNativeZoom: 0, maxNativeZoom: 0, minZoom: -3, maxZoom: 2,
      noWrap: true, keepBuffer: 2, updateWhenZooming: false, pane, className,
    });
  }

  function buildMap() {
    if (state.map) { state.map.remove(); state.map = null; }
    const p = state.pack;
    state.H = p.tiles.tileSize * p.tiles.rows;
    const map = L.map('map', {
      crs: L.CRS.Simple, minZoom: -3, maxZoom: 2, zoomSnap: 0.25, zoomDelta: 0.5,
      zoomControl: false, attributionControl: false, preferCanvas: false,
    });
    state.map = map;
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.createPane('base').style.zIndex = 200;
    map.createPane('scrim').style.zIndex = 220;
    map.createPane('floor').style.zIndex = 240;
    tileLayer(p.tiles, 'base', 'base-tiles').addTo(map);
    const content = p.bounds ? boundsLL(p.bounds) : L.latLngBounds([0, 0], [state.H, p.tiles.tileSize * p.tiles.columns]);
    state.contentBounds = content;
    state.scrim = L.rectangle(content.pad(1), { pane: 'scrim', stroke: false, fillColor: '#000', fillOpacity: 0, interactive: false, className: 'floor-scrim' }).addTo(map);
    state.markerLayer = L.layerGroup().addTo(map);
    state.areaLayer = L.layerGroup();
    for (const a of p.areas) {
      const c = [(a.b.minX + a.b.maxX) / 2, (a.b.minY + a.b.maxY) / 2];
      state.areaLayer.addLayer(L.tooltip({ permanent: true, direction: 'center', className: 'area-label', interactive: false })
        .setLatLng(ll(c[0], c[1])).setContent(esc(a.n)));
    }
    if (state.opts.showAreas) state.areaLayer.addTo(map);
    map.fitBounds(p.view ? boundsLL(p.view) : content, { animate: false });
    map.setMaxBounds(content.pad(0.25));
    map.on('popupclose', () => setHash(null));
  }

  function applyFloor() {
    const p = state.pack;
    if (state.floorLayer) { state.map.removeLayer(state.floorLayer); state.floorLayer = null; }
    const fl = (p.layers || []).find((l) => l.id === state.floor);
    state.scrim.setStyle({ fillOpacity: fl ? 0.45 : 0 });
    if (fl) state.floorLayer = tileLayer(fl.t, 'floor', 'floor-tiles').addTo(state.map);
  }

  /* ---------- markers ---------- */
  function iconFor(m, done) {
    const c = state.pack.cats[m[1]];
    const inner = c.i ? `<img src="${iconSrc(c.i)}" alt="">` : `<div class="dot" style="background:${c.c}"></div>`;
    return L.divIcon({ className: '', html: `<div class="mk${done ? ' done' : ''}">${inner}</div>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -12] });
  }

  function descText(di) {
    if (di < 0) return '';
    const d = state.pack.descs[di];
    return d.k != null ? d.k : `${d.p || ''} ${d.o}`;
  }

  function buildSearchIdx() {
    const p = state.pack;
    state.searchIdx = p.markers.map((m) => norm(p.cats[m[1]].n + ' ' + descText(m[5])));
  }

  function isVisible(m, i) {
    const p = state.pack;
    if (state.focusId === m[0]) return true;
    if (state.floor && m[4] !== state.floor) return false;
    if (state.opts.hideDone && state.done.has(m[0])) return false;
    if (state.search) {
      if (!state.searchIdx) buildSearchIdx();
      return state.searchIdx[i].includes(state.search);
    }
    return state.visible.has(p.cats[m[1]].n);
  }

  function renderMarkers() {
    const p = state.pack;
    state.markerLayer.clearLayers();
    state.lmarkers.clear();
    let shown = 0;
    p.markers.forEach((m, i) => {
      if (!isVisible(m, i)) return;
      const done = state.done.has(m[0]);
      const lm = L.marker(ll(m[2], m[3]), { icon: iconFor(m, done), zIndexOffset: done ? -500 : 0, keyboard: false, riseOnHover: true });
      lm._wm = m;
      lm.on('click', () => onMarkerClick(lm));
      state.markerLayer.addLayer(lm);
      state.lmarkers.set(m[0], lm);
      shown++;
    });
    updateProgressPill();
    return shown;
  }

  function onMarkerClick(lm) {
    const m = lm._wm;
    if (state.opts.quick) { toggleDone(m[0]); return; }
    lm.unbindPopup();
    lm.bindPopup(popupEl(m), { maxWidth: 320, autoPanPaddingTopLeft: [10, 70] }).openPopup();
    setHash(m[0]);
  }

  function popupEl(m) {
    const p = state.pack; const c = p.cats[m[1]];
    const grp = (p.groups.find((g) => g.id === c.g) || {}).n || '';
    const floor = m[4] !== '0' ? ((p.layers || []).find((l) => l.id === m[4]) || {}).n : '';
    const el = document.createElement('div');
    let desc = '';
    if (m[5] >= 0) {
      const d = p.descs[m[5]];
      if (d.k != null) desc = esc(d.k);
      else {
        const url = `https://papago.naver.com/?sk=${d.l === 'vi' ? 'vi' : 'zh-CN'}&tk=ko&st=${encodeURIComponent(d.o)}`;
        desc = `${d.p ? esc(d.p) + ' · ' : ''}<span class="orig">${esc(d.o)}</span>\n<a class="tr" href="${url}" target="_blank" rel="noopener">↗ 파파고로 번역 보기</a>`;
      }
    }
    el.innerHTML = `
      <div class="pp-head">${c.i ? `<img src="${iconSrc(c.i)}" alt="">` : ''}<div>
        <div class="pp-title">${esc(c.n)}</div>
        <div class="pp-sub">${esc(grp)}${floor ? ' · ' + esc(floor) : ''}</div></div></div>
      ${desc ? `<div class="pp-desc">${desc}</div>` : ''}
      <button class="pp-btn"></button>
      <div class="pp-meta"><span>X ${m[2]} · Y ${m[3]}</span><a data-copy>링크 복사</a></div>`;
    const btn = $('.pp-btn', el);
    const sync = () => { const d = state.done.has(m[0]); btn.textContent = d ? '✓ 획득함 (누르면 해제)' : '획득 체크'; btn.classList.toggle('done', d); };
    sync();
    btn.addEventListener('click', () => { toggleDone(m[0]); sync(); });
    $('[data-copy]', el).addEventListener('click', () => {
      const url = location.href.split('#')[0] + `#map=${encodeURIComponent(state.packId)}&m=${m[0]}`;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('링크를 복사했습니다'), () => toast(url));
    });
    return el;
  }

  function toggleDone(id) {
    const now = !state.done.has(id);
    if (now) state.done.add(id); else state.done.delete(id);
    saveDone(); touchMap(state.packId);
    const lm = state.lmarkers.get(id);
    const p = state.pack;
    const idx = p.markers.findIndex((m) => m[0] === id);
    if (idx >= 0) {
      const ci = p.markers[idx][1];
      state.catDone[ci] += now ? 1 : -1;
      updateCatCount(ci);
    }
    if (lm) {
      if (now && state.opts.hideDone && state.focusId !== id) {
        state.markerLayer.removeLayer(lm); state.lmarkers.delete(id);
      } else {
        lm.setIcon(iconFor(lm._wm, now)); lm.setZIndexOffset(now ? -500 : 0);
      }
    }
    updateProgressPill();
    if ($('#tab-progress').classList.contains('active')) renderProgressMap();
    if (state.opts.quick) toast(now ? '획득 체크' : '체크 해제');
  }

  function updateProgressPill() {
    const p = state.pack; let tot = 0, dn = 0;
    p.markers.forEach((m) => {
      if (!state.visible.has(p.cats[m[1]].n)) return;
      tot++; if (state.done.has(m[0])) dn++;
    });
    $('#mapProgress').textContent = tot ? `${dn}/${tot}` : '–';
  }

  /* ---------- category list ---------- */
  function computeCounts() {
    const p = state.pack;
    state.catTotal = p.cats.map(() => 0); state.catDone = p.cats.map(() => 0);
    for (const m of p.markers) { state.catTotal[m[1]]++; if (state.done.has(m[0])) state.catDone[m[1]]++; }
  }
  function updateCatCount(ci) {
    const row = $(`.cat[data-ci="${ci}"]`);
    if (!row) return;
    $('.ct', row).textContent = `${state.catDone[ci]}/${state.catTotal[ci]}`;
    row.classList.toggle('full', state.catDone[ci] === state.catTotal[ci]);
    const g = row.closest('.grp'); if (g) updateGroupCount(g);
  }
  function updateGroupCount(g) {
    let t = 0, d = 0;
    $$('.cat', g).forEach((r) => { const ci = +r.dataset.ci; t += state.catTotal[ci]; d += state.catDone[ci]; });
    $('.cnt', g).textContent = `${d}/${t}`;
  }

  function renderCatList() {
    const p = state.pack; const box = $('#catList'); box.innerHTML = '';
    const openGroups = new Set(LS.get('wuwa-ko:openGroups', ['collection']));
    for (const g of p.groups) {
      const cis = p.cats.map((c, i) => i).filter((i) => p.cats[i].g === g.id && state.catTotal[i] > 0);
      if (!cis.length) continue;
      cis.sort((a, b) => (isChest(p.cats[b].n) - isChest(p.cats[a].n)) || p.cats[a].n.localeCompare(p.cats[b].n, 'ko'));
      const el = document.createElement('div');
      el.className = 'grp' + (openGroups.has(g.id) ? ' open' : '');
      el.innerHTML = `<div class="grp-head"><span class="arrow">▶</span><span class="name">${esc(g.n)}</span><span class="cnt"></span></div>
        <div class="grp-body"><div class="grp-tools"><button data-a="all">이 그룹 전체</button><button data-a="none">해제</button></div></div>`;
      const body = $('.grp-body', el);
      for (const i of cis) {
        const c = p.cats[i];
        const r = document.createElement('label');
        r.className = 'cat'; r.dataset.ci = i;
        r.innerHTML = `<input type="checkbox" ${state.visible.has(c.n) ? 'checked' : ''}>${c.i ? `<img src="${iconSrc(c.i)}" alt="">` : `<span class="sw" style="background:${c.c}"></span>`}<span class="nm">${esc(c.n)}</span><span class="ct"></span>`;
        $('input', r).addEventListener('change', (e) => {
          if (e.target.checked) state.visible.add(c.n); else state.visible.delete(c.n);
          saveVis(); renderMarkers();
        });
        body.appendChild(r);
      }
      $('.grp-head', el).addEventListener('click', () => {
        el.classList.toggle('open');
        if (el.classList.contains('open')) openGroups.add(g.id); else openGroups.delete(g.id);
        LS.set('wuwa-ko:openGroups', [...openGroups]);
      });
      $$('.grp-tools button', el).forEach((b) => b.addEventListener('click', () => {
        for (const i of cis) { if (b.dataset.a === 'all') state.visible.add(p.cats[i].n); else state.visible.delete(p.cats[i].n); }
        saveVis(); syncCatChecks(); renderMarkers();
      }));
      box.appendChild(el);
      cis.forEach(updateCatCount);
      updateGroupCount(el);
    }
  }
  function syncCatChecks() {
    $$('.cat').forEach((r) => { $('input', r).checked = state.visible.has(state.pack.cats[+r.dataset.ci].n); });
  }

  function renderFloors() {
    const p = state.pack; const sel = $('#floorSelect');
    const layers = p.layers || [];
    $('#floorBox').classList.toggle('hidden', !layers.length);
    sel.innerHTML = '<option value="">지상 + 전체 층 (모든 마커)</option>';
    const byG = new Map();
    for (const l of layers) { if (!byG.has(l.gid)) byG.set(l.gid, { n: l.gn, ls: [] }); byG.get(l.gid).ls.push(l); }
    for (const g of byG.values()) {
      const og = document.createElement('optgroup'); og.label = g.n;
      for (const l of g.ls) {
        const cnt = p.markers.filter((m) => m[4] === l.id).length;
        const o = document.createElement('option'); o.value = l.id; o.textContent = `${l.n} (${cnt})`; og.appendChild(o);
      }
      sel.appendChild(og);
    }
    sel.value = state.floor;
  }

  /* ---------- progress tab ---------- */
  function progRow(label, d, t) {
    return `<div class="prow"><div class="top"><span>${esc(label)}</span><b>${d}/${t} · ${pct(d, t)}%</b></div><div class="bar"><i style="width:${pct(d, t)}%"></i></div></div>`;
  }
  function renderProgressMap() {
    const p = state.pack; let html = '';
    const rows = p.cats.map((c, i) => ({ c, i })).filter(({ c, i }) => c.g === 'collection' && state.catTotal[i] > 0);
    rows.sort((a, b) => (isChest(b.c.n) - isChest(a.c.n)) || a.c.n.localeCompare(b.c.n, 'ko'));
    let ct = 0, cd = 0;
    for (const { c, i } of rows) if (isChest(c.n)) { ct += state.catTotal[i]; cd += state.catDone[i]; }
    html += progRow('보물상자 + 조석의 유산 합계', cd, ct);
    for (const { c, i } of rows) html += progRow(c.n, state.catDone[i], state.catTotal[i]);
    $('#progMap').innerHTML = html || '<p class="muted">수집 항목이 없습니다.</p>';
  }
  async function calcAll() {
    const box = $('#progAll'); box.innerHTML = '<p class="muted">계산 중…</p>';
    try {
      let html = ''; const grand = new Map();
      for (const g of state.catalog.groups) {
        const per = new Map();
        for (const id of g.maps) {
          const p = await fetchPack(id);
          for (const m of p.markers) {
            const n = p.cats[m[1]].n; if (!isChest(n)) continue;
            for (const tgt of [per, grand]) {
              const v = tgt.get(n) || [0, 0]; v[1]++; if (state.done.has(m[0])) v[0]++; tgt.set(n, v);
            }
          }
        }
        let d = 0, t = 0; for (const v of per.values()) { d += v[0]; t += v[1]; }
        html += progRow(g.n, d, t);
      }
      let gh = '';
      for (const [n, v] of [...grand.entries()].sort()) gh += progRow(n, v[0], v[1]);
      box.innerHTML = '<p class="muted small">지역별 (보물상자 + 조석의 유산)</p>' + html + '<p class="muted small">종류별 전체</p>' + gh;
    } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }

  /* ---------- picker ---------- */
  function renderPicker() {
    const body = $('#pickerBody'); let html = '';
    for (const g of state.catalog.groups) {
      html += `<div class="pk-group"><h4>${esc(g.n)}</h4>`;
      const secs = g.sections.length ? g.sections : [{ n: '', maps: g.maps }];
      const inSec = new Set(secs.flatMap((s) => s.maps));
      const rest = g.maps.filter((id) => !inSec.has(id));
      for (const s of rest.length ? [...secs, { n: '기타', maps: rest }] : secs) {
        if (s.n) html += `<div class="pk-sec">${esc(s.n)}</div>`;
        html += '<div class="pk-maps">';
        for (const id of s.maps) {
          const mm = state.catalog.maps[id]; if (!mm) continue;
          html += `<button class="pk-map${id === state.packId ? ' cur' : ''}" data-id="${esc(id)}"><div class="t">${esc(mm.title)}</div><div class="s">마커 ${mm.count.toLocaleString()}개</div></button>`;
        }
        html += '</div>';
      }
      html += '</div>';
    }
    body.innerHTML = html;
    $$('.pk-map', body).forEach((b) => b.addEventListener('click', () => { $('#picker').classList.add('hidden'); loadMap(b.dataset.id); }));
  }

  /* ---------- load ---------- */
  async function loadMap(id, focusMarker) {
    if (!state.catalog.maps[id]) id = state.catalog.defaultMapId;
    $('#mapTitle').textContent = '불러오는 중…';
    const p = await fetchPack(id);
    state.packId = id; state.pack = p; state.floor = ''; state.searchIdx = null; state.focusId = null;
    LS.set(K.last, id);
    if (!state.visibleInit) {
      for (const c of p.cats) if (isChest(c.n)) state.visible.add(c.n);
      state.visibleInit = true; saveVis();
    }
    $('#mapTitle').textContent = p.title;
    document.title = `${p.title} · 명조 지도`;
    computeCounts();
    buildMap();
    renderFloors(); applyFloor();
    renderCatList();
    renderMarkers();
    if ($('#tab-progress').classList.contains('active')) renderProgressMap();
    setHash(null);
    if (focusMarker) focus(focusMarker);
  }

  function focus(markerId) {
    const p = state.pack; const m = p.markers.find((x) => x[0] === markerId);
    if (!m) return;
    state.focusId = markerId;
    if (state.floor && m[4] !== state.floor) { state.floor = ''; $('#floorSelect').value = ''; applyFloor(); }
    renderMarkers();
    const lm = state.lmarkers.get(markerId);
    state.map.setView(ll(m[2], m[3]), 1, { animate: false });
    if (lm) { lm.unbindPopup(); lm.bindPopup(popupEl(m), { maxWidth: 320 }).openPopup(); setHash(m[0]); }
  }

  function bindUI() {
    const panel = $('#panel');
    const openPanel = (v) => panel.classList.toggle('hidden', !v);
    $('#btnPanel').addEventListener('click', () => openPanel(panel.classList.contains('hidden')));
    $('#btnClosePanel').addEventListener('click', () => openPanel(false));
    $$('.tabs button[data-tab]').forEach((b) => b.addEventListener('click', () => {
      $$('.tabs button[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
      $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
      if (b.dataset.tab === 'progress') renderProgressMap();
      if (b.dataset.tab === 'settings') $('#statsLine').textContent = `저장된 획득 체크: ${state.done.size.toLocaleString()}개`;
    }));
    $('#btnMapPicker').addEventListener('click', () => { renderPicker(); $('#picker').classList.remove('hidden'); });
    $('#btnClosePicker').addEventListener('click', () => $('#picker').classList.add('hidden'));
    $('#picker').addEventListener('click', (e) => { if (e.target.id === 'picker') e.currentTarget.classList.add('hidden'); });

    let st;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(st); st = setTimeout(() => { state.search = norm(e.target.value); state.focusId = null; renderMarkers(); }, 200);
    });
    $('#floorSelect').addEventListener('change', (e) => {
      state.floor = e.target.value; state.focusId = null; applyFloor(); renderMarkers();
      if (state.floor) {
        const pts = state.pack.markers.filter((m) => m[4] === state.floor).map((m) => ll(m[2], m[3]));
        if (pts.length) state.map.fitBounds(L.latLngBounds(pts).pad(0.6), { maxZoom: 1 });
      }
      if (window.innerWidth <= 720) panel.classList.add('hidden');
    });
    const hd = $('#hideDone'); hd.checked = state.opts.hideDone;
    hd.addEventListener('change', () => { state.opts.hideDone = hd.checked; saveOpts(); renderMarkers(); });
    const sa = $('#showAreas'); sa.checked = state.opts.showAreas;
    sa.addEventListener('change', () => {
      state.opts.showAreas = sa.checked; saveOpts();
      if (sa.checked) state.areaLayer.addTo(state.map); else state.map.removeLayer(state.areaLayer);
    });
    const q = $('#btnQuick'); q.setAttribute('aria-pressed', state.opts.quick);
    q.addEventListener('click', () => {
      state.opts.quick = !state.opts.quick; saveOpts(); q.setAttribute('aria-pressed', state.opts.quick);
      toast(state.opts.quick ? '빠른 체크 켬: 마커를 누르면 바로 획득/해제됩니다' : '빠른 체크 끔');
    });
    $('#selAll').addEventListener('click', () => { state.pack.cats.forEach((c, i) => { if (state.catTotal[i]) state.visible.add(c.n); }); saveVis(); syncCatChecks(); renderMarkers(); });
    $('#selNone').addEventListener('click', () => { state.pack.cats.forEach((c) => state.visible.delete(c.n)); saveVis(); syncCatChecks(); renderMarkers(); });
    $('#selChests').addEventListener('click', () => {
      state.pack.cats.forEach((c) => { if (isChest(c.n)) state.visible.add(c.n); else state.visible.delete(c.n); });
      saveVis(); syncCatChecks(); renderMarkers();
    });
    $('#btnCalcAll').addEventListener('click', calcAll);
    $('#btnExport').addEventListener('click', async () => {
      const json = JSON.stringify({ app: 'wuwa-map-ko', version: 1, exportedAt: new Date().toISOString(), done: [...state.done] });
      const filename = `wuwa-map-progress-${new Date().toISOString().slice(0, 10)}.json`;
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
      if (dl) {
        try { await dl.save({ filename, data: json }); } catch { toast('저장이 취소되었습니다'); }
        return;
      }
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('#fileImport').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        const ids = Array.isArray(j) ? j : j.done;
        if (!Array.isArray(ids)) throw new Error();
        let added = 0; for (const id of ids) { const s = String(id).replace('kuro:', ''); if (!state.done.has(s)) { state.done.add(s); added++; } }
        saveDone(); computeCounts(); renderCatList(); renderMarkers();
        toast(`가져오기 완료: ${added}개 추가 (기존 체크는 유지)`);
        Sync.pushAll();
      } catch { toast('올바른 백업 파일이 아닙니다'); }
      e.target.value = '';
    });
    let resetArmed = 0;
    $('#btnReset').addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (Date.now() - resetArmed > 4000) { resetArmed = Date.now(); b.textContent = '한 번 더 누르면 전부 삭제'; setTimeout(() => { b.textContent = '전체 초기화'; }, 4000); return; }
      resetArmed = 0; b.textContent = '전체 초기화';
      state.done.clear(); saveDone(); computeCounts(); renderCatList(); renderMarkers(); toast('초기화했습니다');
      Sync.pushAll();
    });
    window.addEventListener('hashchange', () => {
      const h = parseHash();
      if (h.map && h.map !== state.packId) loadMap(h.map, h.m);
      else if (h.m && h.m !== state.focusId) focus(h.m);
    });
    if (window.innerWidth > 720) openPanel(true);
  }

  /* ---------- Supabase (minimal REST client: GoTrue auth + PostgREST) ---------- */
  const CFG = Object.assign({ supabaseUrl: '', supabaseAnonKey: '' }, window.WUWA_CONFIG || {});
  const SB = {
    url: (CFG.supabaseUrl || '').replace(/\/+$/, ''), key: CFG.supabaseAnonKey || '',
    session: LS.get('wuwa-ko:sb-session', null),
    get enabled() { return !!(this.url && this.key); },
    save(s) { this.session = s; LS.set('wuwa-ko:sb-session', s); renderAccount(); },
    async req(path, { method = 'GET', body, auth = false, headers = {} } = {}) {
      const h = Object.assign({ apikey: this.key, 'Content-Type': 'application/json' }, headers);
      if (auth) { await this.fresh(); if (!this.session) throw new Error('로그인이 필요합니다'); h.Authorization = 'Bearer ' + this.session.access_token; }
      const r = await fetch(this.url + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
      const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { j = null; }
      if (!r.ok) {
        const msg = (j && (j.error_description || j.msg || j.message || j.error)) || ('HTTP ' + r.status);
        const err = new Error(msg); err.status = r.status; throw err;
      }
      return j;
    },
    withExpiry(t) { return Object.assign({}, t, { expires_at: t.expires_at || Math.floor(Date.now() / 1000) + (t.expires_in || 3600) }); },
    async fresh() {
      const s = this.session; if (!s) return;
      if (s.expires_at - 60 > Date.now() / 1000) return;
      try { this.save(this.withExpiry(await this.req('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } }))); }
      catch (e) { if (e.status === 400 || e.status === 401) { this.save(null); toast('로그인이 만료되어 다시 로그인해야 합니다'); } throw e; }
    },
    async signIn(email, password) { this.save(this.withExpiry(await this.req('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }))); },
    async signUp(email, password) {
      const back = encodeURIComponent(location.href.split('#')[0].split('?')[0]);
      const j = await this.req('/auth/v1/signup?redirect_to=' + back, { method: 'POST', body: { email, password } });
      if (j && j.access_token) { this.save(this.withExpiry(j)); return true; }
      return false; // email confirmation required
    },
    async signOut() { try { if (this.session) await this.req('/auth/v1/logout', { method: 'POST', auth: true }); } catch { /* ignore */ } this.save(null); },
    oauth(provider) {
      const back = location.href.split('#')[0];
      location.href = `${this.url}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(back)}`;
    },
    async handleRedirect() {
      // implicit-flow return: #access_token=...&refresh_token=...  (or #error_description=...)
      const h = new URLSearchParams(location.hash.slice(1));
      if (h.get('error_description')) { toast('로그인 실패: ' + h.get('error_description')); history.replaceState(null, '', location.pathname + location.search); return; }
      if (!h.get('access_token')) return;
      const t = { access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_in: +h.get('expires_in') || 3600, expires_at: +h.get('expires_at') || 0 };
      history.replaceState(null, '', location.pathname + location.search);
      this.session = this.withExpiry(t);
      try { const u = await this.req('/auth/v1/user', { auth: true }); this.save(Object.assign({}, this.session, { user: u })); }
      catch (e) { this.save(null); toast('로그인 처리 실패: ' + e.message); }
    },
    get uid() { return this.session && this.session.user && this.session.user.id; },
    get email() { return this.session && this.session.user && (this.session.user.email || this.session.user.id); },
  };

  /* ---------- sync engine: per-map documents {ids, t}; newer t wins, first link merges ---------- */
  const Backends = {
    claude: {
      name: 'claude', col: null,
      async init() {
        if (!(window.claude && window.claude.use)) return false;
        const [db, user] = await Promise.all([window.claude.use('db').catch(() => null), window.claude.use('user').catch(() => null)]);
        if (!db || !user) return false;
        const uid = await user.id().catch(() => null);
        if (!uid) return false;
        this.uid = uid; this.col = db.collection('data/users/' + uid); return true;
      },
      async list() { const snap = await this.col.get(); return snap.docs.filter((d) => d.id.startsWith('p-')).map((d) => Object.assign({ mapId: d.id.slice(2) }, d.data() || {})); },
      async put(mapId, ids, t) { await this.col.doc('p-' + mapId).set({ ids, t }); },
      label: '같은 Claude 계정으로 연 다른 기기와 진행도가 맞춰집니다.',
    },
    supabase: {
      name: 'supabase',
      async init() { if (!SB.enabled || !SB.uid) return false; this.uid = SB.uid; return true; },
      async list() {
        const rows = await SB.req('/rest/v1/wuwa_progress?select=map_id,ids,t', { auth: true });
        return (rows || []).map((r) => ({ mapId: r.map_id, ids: r.ids || [], t: Number(r.t) || 0 }));
      },
      async put(mapId, ids, t) {
        await SB.req('/rest/v1/wuwa_progress?on_conflict=user_id,map_id', { method: 'POST', auth: true, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { user_id: SB.uid, map_id: mapId, ids, t } });
      },
      get label() { return `${SB.email} 계정으로 로그인한 모든 기기와 진행도가 맞춰집니다.`; },
    },
  };

  const Sync = {
    be: null, timers: new Map(), busy: new Map(), pulling: false,
    async start() {
      this.stop();
      for (const b of [Backends.supabase, Backends.claude]) {
        if (await b.init().catch(() => false)) { this.be = b; break; }
      }
      if (!this.be) { setSyncLine(SB.enabled ? '로그인하면 진행도가 계정에 저장되어 다른 기기와 맞춰집니다.' : ''); return; }
      await this.pull(true);
    },
    stop() { for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); this.be = null; },
    async pull(first) {
      if (!this.be || this.pulling) return;
      this.pulling = true; const be = this.be;
      setSyncLine('동기화 중…');
      try {
        const docs = await be.list();
        const mergedKey = 'wuwa-ko:merged-' + be.name + '-' + be.uid;
        const merge = first && !LS.get(mergedKey, false);
        let changed = 0; const seen = new Set();
        for (const d of docs) {
          if (!state.catalog.maps[d.mapId]) continue;
          seen.add(d.mapId);
          const rt = d.t || 0, lt = mtimes[d.mapId] || 0;
          if (merge || rt > lt) {
            const p = await fetchPack(d.mapId); const remote = new Set(d.ids || []);
            for (const m of p.markers) {
              const had = state.done.has(m[0]); const want = merge ? had || remote.has(m[0]) : remote.has(m[0]);
              if (had !== want) { changed++; if (want) state.done.add(m[0]); else state.done.delete(m[0]); }
            }
            if (merge) { mtimes[d.mapId] = Date.now(); this.schedule(d.mapId, 50); } else mtimes[d.mapId] = rt;
          } else if (lt > rt) this.schedule(d.mapId, 50);
        }
        for (const mapId of Object.keys(mtimes)) if (!seen.has(mapId) && state.catalog.maps[mapId]) this.schedule(mapId, 50);
        if (merge) LS.set(mergedKey, true);
        LS.set('wuwa-ko:mtimes', mtimes);
        if (changed) { saveDone(); computeCounts(); renderCatList(); renderMarkers(); if ($('#tab-progress').classList.contains('active')) renderProgressMap(); toast(`다른 기기의 진행도 ${changed}건을 반영했습니다`); }
        setSyncLine('동기화 켜짐 · ' + be.label);
      } catch (e) {
        setSyncLine('동기화 실패: ' + (e.message || e.code || e) + ' (이 브라우저에는 계속 저장됩니다)');
      } finally { this.pulling = false; }
    },
    schedule(mapId, delay = 1500) {
      if (!this.be) return;
      clearTimeout(this.timers.get(mapId));
      this.timers.set(mapId, setTimeout(() => this.push(mapId), delay));
    },
    async push(mapId) {
      const be = this.be; if (!be) return;
      if (this.busy.get(mapId)) { this.schedule(mapId); return; }
      this.busy.set(mapId, true);
      try {
        const p = await fetchPack(mapId);
        const ids = p.markers.filter((m) => state.done.has(m[0])).map((m) => m[0]);
        if (!mtimes[mapId]) { mtimes[mapId] = Date.now(); LS.set('wuwa-ko:mtimes', mtimes); }
        await be.put(mapId, ids, mtimes[mapId]);
      } catch (e) {
        if ((e && e.code === 'unavailable') || (e && (e.status >= 500 || e.status === undefined && e.name === 'TypeError'))) this.schedule(mapId, 4000 + Math.random() * 2000);
        else toast('클라우드 저장 실패: ' + (e.message || e.code || e));
      } finally { this.busy.set(mapId, false); }
    },
    async pushAll() {
      const now = Date.now();
      for (const id of Object.keys(state.catalog.maps)) mtimes[id] = now;
      LS.set('wuwa-ko:mtimes', mtimes);
      if (!this.be) return;
      for (const id of Object.keys(state.catalog.maps)) await this.push(id);
    },
  };
  function setSyncLine(t) { const el = $('#syncLine'); if (el) el.textContent = t; }

  /* ---------- account UI ---------- */
  function renderAccount() {
    const box = $('#accountBox'); if (!box) return;
    if (!SB.enabled) {
      box.innerHTML = '<p class="muted small">이 사이트에는 아직 Supabase 설정(config.js)이 없어 계정 로그인이 꺼져 있습니다.</p>';
      return;
    }
    if (SB.uid) {
      box.innerHTML = `<p class="muted"><b>${esc(SB.email)}</b> 로 로그인됨</p>
        <div class="row wrap btnrow"><button id="btnSyncNow">지금 동기화</button><button id="btnLogout">로그아웃</button></div>`;
      $('#btnSyncNow').onclick = () => Sync.start();
      $('#btnLogout').onclick = async () => { await SB.signOut(); await Sync.start(); toast('로그아웃했습니다 (체크 내용은 이 브라우저에 남아 있습니다)'); };
      return;
    }
    box.innerHTML = `
      <form id="loginForm" class="acct">
        <input id="acEmail" type="email" placeholder="이메일" autocomplete="email" required>
        <input id="acPw" type="password" placeholder="비밀번호 (6자 이상)" autocomplete="current-password" minlength="6" required>
        <div class="row wrap btnrow">
          <button type="submit" data-act="in">로그인</button>
          <button type="submit" data-act="up">회원가입</button>
          ${CFG.google ? '<button type="button" id="btnGoogle">Google로 로그인</button>' : ''}
        </div>
        <p class="muted small" id="acMsg"></p>
      </form>`;
    const form = $('#loginForm'); let act = 'in';
    $$('button[type=submit]', form).forEach((b) => b.addEventListener('click', () => { act = b.dataset.act; }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#acEmail').value.trim(), pw = $('#acPw').value; const msg = $('#acMsg');
      msg.textContent = '처리 중…';
      try {
        if (act === 'up') {
          const ok = await SB.signUp(email, pw);
          if (!ok) { msg.textContent = '가입 확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인하세요.'; return; }
        } else await SB.signIn(email, pw);
        await Sync.start(); toast('로그인했습니다');
      } catch (err) { msg.textContent = '실패: ' + koAuthError(err.message); }
    });
    const g = $('#btnGoogle'); if (g) g.onclick = () => SB.oauth('google');
  }
  function koAuthError(m) {
    const map = { 'Invalid login credentials': '이메일 또는 비밀번호가 틀렸습니다', 'Email not confirmed': '가입 확인 메일의 링크를 먼저 눌러야 합니다', 'User already registered': '이미 가입된 이메일입니다' };
    return map[m] || m;
  }

  async function init() {
    bindUI();
    try {
      if (SB.enabled) await SB.handleRedirect();
      renderAccount();
      await Pack.init();
      const res = await fetch('data/catalog.json');
      state.catalog = await res.json();
      const h = parseHash();
      await loadMap(h.map || LS.get(K.last, null) || state.catalog.defaultMapId, h.m);
      await Sync.start();
      document.addEventListener('visibilitychange', () => { if (!document.hidden && Sync.be) Sync.pull(false); });
    } catch (e) {
      $('#mapTitle').textContent = '불러오기 실패';
      toast(e.message || String(e));
      console.error(e);
    }
  }
  init();
})();
