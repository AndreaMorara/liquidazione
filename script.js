/* ── Utilities ── */

function parseTxt(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (key) result[key] = val;
  }
  return result;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

/* ── Skeleton loaders ── */

function renderSkeletons(n = 6) {
  const grid = document.getElementById('grid');
  grid.innerHTML = Array.from({ length: n }, () => `
    <div class="card-skeleton">
      <div class="sk-cover skeleton"></div>
      <div class="sk-body">
        <div class="sk-line wide skeleton"></div>
        <div class="sk-line short skeleton"></div>
      </div>
    </div>
  `).join('');
}

/* ── Site config ── */

async function loadSiteConfig() {
  try {
    const text = await fetchText('sito.txt');
    const cfg = parseTxt(text);

    const titleEl    = document.getElementById('site-title');
    const subtitleEl = document.getElementById('site-subtitle');
    if (cfg.nome)       titleEl.textContent    = cfg.nome;
    if (cfg.sottotitolo) subtitleEl.textContent = cfg.sottotitolo;
    document.title = cfg.nome || document.title;

    renderFooter(cfg);
  } catch (e) {
    console.warn('sito.txt non trovato:', e);
  }
}

function renderFooter(cfg) {
  const el = document.getElementById('footer-content');
  if (!el) return;

  const parts = [];

  if (cfg.email) parts.push(`
    <span class="footer-contact">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>
      <a href="mailto:${cfg.email}">${cfg.email}</a>
    </span>`);

  if (cfg.whatsapp) {
    const num = cfg.whatsapp.replace(/\s+/g, '');
    parts.push(`
    <span class="footer-contact">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.999 2C6.477 2 2 6.477 2 12c0 1.89.518 3.66 1.42 5.185L2 22l4.946-1.39A9.953 9.953 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2z" fill-rule="evenodd" clip-rule="evenodd"/></svg>
      <a href="https://wa.me/${num.replace('+', '')}">${cfg.whatsapp}</a>
    </span>`);
  }

  if (cfg.citta) parts.push(`
    <span class="footer-contact">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
      ${cfg.citta}
    </span>`);

  if (cfg.note) parts.push(`<p class="footer-note">${cfg.note}</p>`);

  el.innerHTML = parts.join('');
}

/* ── Articles ── */

async function loadArticoli() {
  const ids = await fetchJSON('articoli/index.json');

  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const text = await fetchText(`articoli/${id}/info.txt`);
      const info = parseTxt(text);
      return { id, ...info };
    })
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

function cardHTML(art) {
  const venduto = art.stato === 'venduto';
  const coverSrc = `articoli/${art.id}/cover.jpg`;

  const soldOverlay = venduto ? `
    <div class="sold-overlay">
      <span class="sold-badge">Venduto</span>
    </div>` : '';

  const prezzoHTML = art.prezzo
    ? `<span class="card-price">${art.prezzo}</span>`
    : '';

  return `
    <a class="card" href="articolo.html?id=${art.id}">
      <div class="card-cover">
        <img src="${coverSrc}" alt="${art.titolo || art.id}" loading="lazy"
             onerror="this.src='https://placehold.co/400x300/1c1c1c/444?text=Foto'" />
        ${soldOverlay}
      </div>
      <div class="card-body">
        <div class="card-title">${art.titolo || art.id}</div>
        <div class="card-meta">
          <span class="card-category">${art.categoria || ''}</span>
          ${prezzoHTML}
        </div>
      </div>
    </a>`;
}

/* ── Filters ── */

let allArticoli = [];
let activeFilter = 'tutti';

function buildFilters(articoli) {
  const categories = ['tutti', ...new Set(
    articoli.map(a => a.categoria).filter(Boolean)
  )];

  const container = document.getElementById('filters');
  container.innerHTML = categories.map(cat => `
    <button class="filter-pill${cat === activeFilter ? ' active' : ''}"
            data-cat="${cat}">
      ${cat === 'tutti' ? 'Tutti' : cat}
    </button>`).join('');

  container.addEventListener('click', e => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    activeFilter = pill.dataset.cat;
    container.querySelectorAll('.filter-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.cat === activeFilter)
    );
    renderGrid(allArticoli);
  });
}

function renderGrid(articoli) {
  const grid = document.getElementById('grid');
  const filtered = activeFilter === 'tutti'
    ? articoli
    : articoli.filter(a => a.categoria === activeFilter);

  if (filtered.length === 0) {
    grid.innerHTML = `<p id="empty-state" style="display:block">Nessun articolo in questa categoria.</p>`;
    return;
  }

  grid.innerHTML = filtered.map(cardHTML).join('');
}

/* ── Init ── */

async function init() {
  renderSkeletons(6);
  await loadSiteConfig();

  try {
    allArticoli = await loadArticoli();
    buildFilters(allArticoli);
    renderGrid(allArticoli);
  } catch (e) {
    console.error('Errore nel caricamento articoli:', e);
    document.getElementById('grid').innerHTML =
      `<p style="color:var(--muted);padding:40px 0">Errore nel caricamento degli articoli.</p>`;
  }
}

init();
