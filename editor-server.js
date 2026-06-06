#!/usr/bin/env node
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT         = 3333;
const ROOT         = __dirname;
const ARTICOLI_DIR = path.join(ROOT, 'articoli');

/* ── Helpers ── */

function parseTxt(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function buildTxt(fields) {
  const lines = [];
  if (fields.titolo)      lines.push(`titolo: ${fields.titolo}`);
  if (fields.categoria)   lines.push(`categoria: ${fields.categoria}`);
  if (fields.descrizione) lines.push(`descrizione: ${fields.descrizione}`);
  if (fields.prezzo && fields.prezzo.trim()) lines.push(`prezzo: ${fields.prezzo.trim()}`);
  lines.push(`stato: ${fields.stato === 'venduto' ? 'venduto' : 'disponibile'}`);
  return lines.join('\n') + '\n';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end',  () => resolve(body));
    req.on('error', reject);
  });
}

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function notFound(res) { json(res, { error: 'Not found' }, 404); }

/* ── API handlers ── */

function apiGetArticoli(res) {
  let dirs;
  try {
    dirs = fs.readdirSync(ARTICOLI_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();
  } catch {
    dirs = [];
  }
  json(res, dirs);
}

function apiGetArticolo(res, id) {
  const infoPath = path.join(ARTICOLI_DIR, id, 'info.txt');
  try {
    const text = fs.readFileSync(infoPath, 'utf8');
    json(res, parseTxt(text));
  } catch {
    json(res, {});
  }
}

async function apiPostArticolo(req, res, id) {
  const artDir  = path.join(ARTICOLI_DIR, id);
  const infoPath = path.join(artDir, 'info.txt');

  // Crea cartella se non esiste
  fs.mkdirSync(artDir, { recursive: true });

  let fields;
  try {
    const body = await readBody(req);
    fields = JSON.parse(body);
  } catch {
    json(res, { error: 'JSON non valido' }, 400);
    return;
  }

  try {
    fs.writeFileSync(infoPath, buildTxt(fields), { encoding: 'utf8' });
    json(res, { ok: true });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

/* ── Embedded UI ── */

const HTML = /* html */`<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Editor Liquidazione</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#111;--surface:#1c1c1c;--surface2:#242424;
  --border:#2a2a2a;--text:#f0f0f0;--muted:#777;
  --accent:#e8e0d0;--green:#3a7d44;--green-h:#2e6436;
  --red:#cc3333;--radius:8px;
}
html{font-size:15px}
body{font-family:system-ui,'Inter',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;flex-direction:column}
a{color:inherit;text-decoration:none}

/* Layout */
#app{display:flex;flex:1;overflow:hidden;height:100vh}
#sidebar{width:280px;min-width:220px;border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
#main{flex:1;overflow-y:auto;padding:32px 36px}

/* Sidebar */
#sidebar-header{padding:16px 14px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:8px}
#sidebar-title{font-size:.85rem;font-weight:600;color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
#btn-nuovo{background:var(--accent);color:#111;border:none;border-radius:6px;padding:5px 10px;font-size:.78rem;font-weight:600;cursor:pointer;white-space:nowrap;transition:opacity .15s}
#btn-nuovo:hover{opacity:.8}
#lista{flex:1;overflow-y:auto;padding:8px 0}
.art-item{padding:10px 14px;cursor:pointer;border-left:3px solid transparent;font-size:.88rem;color:var(--text);transition:background .15s,border-color .15s;line-height:1.3}
.art-item:hover{background:var(--surface)}
.art-item.active{background:var(--surface2);border-left-color:var(--accent);color:var(--accent)}
.art-item .art-stato{font-size:.72rem;color:var(--muted);margin-top:2px}
.art-item.venduto .art-stato{color:var(--red)}
#sidebar-empty{padding:24px 14px;font-size:.82rem;color:var(--muted)}

/* Main area */
#placeholder{display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:.9rem}
#form-wrap{max-width:640px}
#form-titolo-bar{display:flex;align-items:center;gap:10px;margin-bottom:24px}
#form-id{font-size:.78rem;color:var(--muted);background:var(--surface);padding:4px 10px;border-radius:4px;border:1px solid var(--border)}

label{display:block;font-size:.78rem;font-weight:500;color:var(--muted);letter-spacing:.04em;text-transform:uppercase;margin-bottom:5px}
.field{margin-bottom:18px}
input[type=text],textarea,select{
  width:100%;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  color:var(--text);font-family:inherit;font-size:.9rem;padding:9px 12px;outline:none;
  transition:border-color .2s;-webkit-appearance:none;appearance:none
}
input[type=text]:focus,textarea:focus,select:focus{border-color:var(--accent)}
textarea{resize:vertical;min-height:120px;line-height:1.6}
select option{background:var(--surface)}

#btn-salva{
  background:var(--green);color:#fff;border:none;border-radius:var(--radius);
  padding:10px 28px;font-size:.9rem;font-weight:600;cursor:pointer;
  transition:background .2s,transform .1s;margin-top:4px
}
#btn-salva:hover{background:var(--green-h)}
#btn-salva:active{transform:scale(.97)}

#toast{
  display:none;margin-left:16px;font-size:.82rem;font-weight:500;padding:6px 12px;
  border-radius:5px;border:1px solid transparent;vertical-align:middle
}
#toast.ok{display:inline-block;background:#1a3a1e;color:#6fcf80;border-color:#2e6436}
#toast.err{display:inline-block;background:#3a1a1a;color:#f08080;border-color:#7a2222}
</style>
</head>
<body>
<div id="app">

  <!-- Sidebar -->
  <aside id="sidebar">
    <div id="sidebar-header">
      <span id="sidebar-title">Articoli</span>
      <button id="btn-nuovo">+ Nuovo</button>
    </div>
    <div id="lista"></div>
  </aside>

  <!-- Editor -->
  <div id="main">
    <div id="placeholder">← Seleziona un articolo o creane uno nuovo</div>

    <div id="form-wrap" style="display:none">
      <div id="form-titolo-bar">
        <span id="form-id"></span>
      </div>

      <div class="field">
        <label for="f-titolo">Titolo</label>
        <input type="text" id="f-titolo" placeholder="es. Bancone reception"/>
      </div>
      <div class="field">
        <label for="f-categoria">Categoria</label>
        <input type="text" id="f-categoria" placeholder="es. Arredo, Tecnologia…"/>
      </div>
      <div class="field">
        <label for="f-descrizione">Descrizione</label>
        <textarea id="f-descrizione" rows="5" placeholder="Descrizione dettagliata dell'articolo…"></textarea>
      </div>
      <div class="field">
        <label for="f-prezzo">Prezzo <span style="font-weight:400;text-transform:none;letter-spacing:0">(opzionale)</span></label>
        <input type="text" id="f-prezzo" placeholder="es. 350€"/>
      </div>
      <div class="field">
        <label for="f-stato">Stato</label>
        <select id="f-stato">
          <option value="disponibile">Disponibile</option>
          <option value="venduto">Venduto</option>
        </select>
      </div>

      <button id="btn-salva">Salva</button>
      <span id="toast"></span>
    </div>
  </div>

</div>

<script>
let articoli = [];
let currentId = null;

async function loadLista() {
  const res = await fetch('/api/articoli');
  articoli = await res.json();
  renderLista();
}

function renderLista() {
  const el = document.getElementById('lista');
  if (!articoli.length) {
    el.innerHTML = '<div id="sidebar-empty">Nessun articolo.<br>Clicca + Nuovo.</div>';
    return;
  }
  el.innerHTML = articoli.map(id => {
    const active  = id === currentId ? ' active' : '';
    return \`<div class="art-item\${active}" data-id="\${id}" onclick="openArticolo(this.dataset.id)">
      \${id}
    </div>\`;
  }).join('');
}

async function openArticolo(id) {
  currentId = id;
  renderLista();

  const res    = await fetch('/api/articolo/' + encodeURIComponent(id));
  const fields = await res.json();

  document.getElementById('form-id').textContent        = id;
  document.getElementById('f-titolo').value             = fields.titolo       || '';
  document.getElementById('f-categoria').value          = fields.categoria    || '';
  document.getElementById('f-descrizione').value        = fields.descrizione  || '';
  document.getElementById('f-prezzo').value             = fields.prezzo       || '';
  document.getElementById('f-stato').value              = fields.stato === 'venduto' ? 'venduto' : 'disponibile';

  document.getElementById('placeholder').style.display = 'none';
  document.getElementById('form-wrap').style.display   = 'block';
  hideToast();
}

document.getElementById('btn-nuovo').addEventListener('click', async () => {
  const nome = prompt('Nome cartella per il nuovo articolo\\n(usa solo lettere, numeri e trattini):');
  if (!nome || !nome.trim()) return;
  const id = nome.trim();

  // Crea subito mandando un info.txt vuoto
  await fetch('/api/articolo/' + encodeURIComponent(id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titolo: id, categoria: '', descrizione: '', prezzo: '', stato: 'disponibile' })
  });

  await loadLista();
  openArticolo(id);
});

document.getElementById('btn-salva').addEventListener('click', async () => {
  if (!currentId) return;
  const fields = {
    titolo:       document.getElementById('f-titolo').value,
    categoria:    document.getElementById('f-categoria').value,
    descrizione:  document.getElementById('f-descrizione').value,
    prezzo:       document.getElementById('f-prezzo').value,
    stato:        document.getElementById('f-stato').value,
  };

  try {
    const res = await fetch('/api/articolo/' + encodeURIComponent(currentId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    const data = await res.json();
    if (data.ok) {
      showToast('Salvato ✓', 'ok');
      await loadLista(); // aggiorna stato nella sidebar
    } else {
      showToast('Errore: ' + (data.error || '?'), 'err');
    }
  } catch (e) {
    showToast('Errore di rete', 'err');
  }
});

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = ''; t.style.display = 'none'; }, 3000);
}
function hideToast() {
  const t = document.getElementById('toast');
  t.className = '';
}

loadLista();
</script>
</body>
</html>`;

/* ── Router ── */

const server = http.createServer(async (req, res) => {
  const url    = req.url;
  const method = req.method;

  // CORS / cache headers
  res.setHeader('Cache-Control', 'no-store');

  // API
  if (url === '/api/articoli' && method === 'GET') {
    return apiGetArticoli(res);
  }

  const matchGet  = url.match(/^\/api\/articolo\/([^/?]+)$/);
  const matchPost = url.match(/^\/api\/articolo\/([^/?]+)$/);

  if (matchGet && method === 'GET') {
    return apiGetArticolo(res, decodeURIComponent(matchGet[1]));
  }

  if (matchPost && method === 'POST') {
    return apiPostArticolo(req, res, decodeURIComponent(matchPost[1]));
  }

  // UI
  if ((url === '/' || url === '/index.html') && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }

  notFound(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Editor in ascolto su http://127.0.0.1:${PORT}`);
});
