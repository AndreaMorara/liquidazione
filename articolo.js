/* articolo.js — logica pagina singolo articolo */

async function initArticolo() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (!id) { location.href = 'index.html'; return; }

  await loadSiteConfig();

  try {
    const text = await fetchText(`articoli/${id}/info.txt`);
    const info = parseTxt(text);
    renderArticolo(id, info);
    await renderFoto(id, info);
    setupCTA(info);
  } catch (e) {
    console.error('Errore caricamento articolo:', e);
    document.getElementById('articolo-titolo').textContent = 'Articolo non trovato';
  }
}

function renderArticolo(id, info) {
  document.title = (info.titolo || id) + ' — ' + document.getElementById('site-title').textContent;

  document.getElementById('articolo-titolo').textContent = info.titolo || id;

  const meta = document.getElementById('articolo-meta');
  const parts = [];

  if (info.categoria) parts.push(`<span class="meta-item">${info.categoria}</span>`);

  if (info.prezzo) parts.push(`<span class="meta-item prezzo">${info.prezzo}</span>`);

  if (info.stato === 'venduto') {
    parts.push(`<span class="meta-item venduto-badge">Venduto</span>`);
  }

  meta.innerHTML = parts.join('');

  if (info.descrizione) {
    document.getElementById('articolo-descrizione').textContent = info.descrizione;
  }
}

async function renderFoto(id, info) {
  const grid = document.getElementById('foto-grid');

  let nomi = [];
  try {
    const txt = await fetchText(`articoli/${id}/foto.txt`);
    nomi = txt.split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    // nessun foto.txt — griglia vuota
  }

  // cover sempre prima
  const tutte = [
    { src: `articoli/${id}/cover.jpg`, label: `${info.titolo || id} — copertina` },
    ...nomi.map((n, i) => ({ src: `articoli/${id}/${n}`, label: `${info.titolo || id} — foto ${i + 1}` }))
  ];

  grid.innerHTML = tutte.map(f => `
    <a class="foto-thumb glightbox" href="${f.src}" data-gallery="articolo" data-description="${f.label}">
      <img src="${f.src}" alt="${f.label}" loading="lazy"
           onerror="this.closest('.foto-thumb').style.display='none'" />
    </a>`).join('');

  GLightbox({ selector: '.glightbox', touchNavigation: true, loop: false });
}

function setupCTA(info) {
  const siteTitle = document.getElementById('site-title').textContent;
  const titolo = info.titolo || 'articolo';
  const msg = encodeURIComponent(`Ciao, sono interessato a: ${titolo} — ${siteTitle}`);

  // recupera numero WhatsApp dal footer (già popolato da loadSiteConfig)
  // attendiamo il DOM con un piccolo delay se necessario
  setTimeout(() => {
    const waLink = document.querySelector('#footer-content a[href^="https://wa.me/"]');
    const num = waLink ? waLink.href.replace('https://wa.me/', '') : '';
    const url = num
      ? `https://wa.me/${num}?text=${msg}`
      : `https://wa.me/?text=${msg}`;

    document.getElementById('cta-desktop').href = url;
    document.getElementById('cta-mobile').href = url;
  }, 300);
}

initArticolo();
