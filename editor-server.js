#!/usr/bin/env node
'use strict';

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const { exec } = require('child_process');

const PORT         = 3333;
const ROOT         = __dirname;
const ARTICOLI_DIR = path.join(ROOT, 'articoli');
const SITO_TXT     = path.join(ROOT, 'sito.txt');

const IMG_EXT = ['.jpg', '.jpeg', '.png'];

/* ─────────────────────────  Helpers  ───────────────────────── */

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

function buildInfoTxt(f) {
  const lines = [];
  if (f.titolo)      lines.push(`titolo: ${f.titolo}`);
  if (f.categoria)   lines.push(`categoria: ${f.categoria}`);
  if (f.descrizione) lines.push(`descrizione: ${f.descrizione}`);
  if (f.prezzo && String(f.prezzo).trim()) lines.push(`prezzo: ${String(f.prezzo).trim()}`);
  lines.push(`stato: ${f.stato === 'venduto' ? 'venduto' : 'disponibile'}`);
  return lines.join('\n') + '\n';
}

function buildSitoTxt(f) {
  const order = ['nome', 'sottotitolo', 'citta', 'email', 'whatsapp', 'note'];
  const lines = [];
  for (const k of order) {
    if (f[k] !== undefined && String(f[k]).trim() !== '') {
      lines.push(`${k}: ${String(f[k]).trim()}`);
    }
  }
  return lines.join('\n') + '\n';
}

function slugify(s) {
  return String(s).toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accenti
    .replace(/[^a-z0-9\s-]/g, '')                        // caratteri speciali
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function listFoto(dir) {
  // tutte le immagini tranne cover.jpg, ordinate secondo foto.txt se presente
  let files;
  try {
    files = fs.readdirSync(dir).filter(n =>
      IMG_EXT.includes(path.extname(n).toLowerCase()) && n.toLowerCase() !== 'cover.jpg'
    );
  } catch { return []; }

  const fotoTxt = path.join(dir, 'foto.txt');
  if (fs.existsSync(fotoTxt)) {
    const order = fs.readFileSync(fotoTxt, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
    const ordered = [];
    for (const n of order) if (files.includes(n)) ordered.push(n);
    for (const n of files) if (!ordered.includes(n)) ordered.push(n); // foto nuove non in foto.txt
    return ordered;
  }
  return files.sort();
}

function hasCover(dir) {
  return fs.existsSync(path.join(dir, 'cover.jpg'));
}

function safeId(id) {
  // niente path traversal
  return id && !id.includes('/') && !id.includes('\\') && !id.includes('..');
}

function safeFilename(name) {
  return name && !name.includes('/') && !name.includes('\\') && !name.includes('..');
}

/* ─────────────────────────  HTTP utils  ───────────────────────── */

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function notFound(res) { json(res, { error: 'Not found' }, 404); }
function badReq(res, msg) { json(res, { error: msg || 'Bad request' }, 400); }

function readBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBodyBuffer(req);
  try { return JSON.parse(buf.toString('utf8') || '{}'); }
  catch { return null; }
}

/* ── Parser multipart/form-data minimale (solo built-in) ── */
function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return [];
  const boundary = '--' + (m[1] || m[2]).trim();
  const bBuf = Buffer.from(boundary);
  const parts = [];

  let start = buffer.indexOf(bBuf);
  if (start === -1) return [];
  start += bBuf.length;

  while (true) {
    // dopo il boundary: o "\r\n" (altra parte) o "--" (fine)
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break; // "--" => fine
    if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2;

    const next = buffer.indexOf(bBuf, start);
    if (next === -1) break;

    // contenuto della parte (escludendo il \r\n finale prima del boundary)
    let partEnd = next;
    if (buffer[partEnd - 2] === 0x0d && buffer[partEnd - 1] === 0x0a) partEnd -= 2;

    const part = buffer.slice(start, partEnd);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString('utf8');
      const content = part.slice(headerEnd + 4);
      const fnMatch = /filename="([^"]*)"/i.exec(headers);
      if (fnMatch && fnMatch[1]) {
        parts.push({ filename: fnMatch[1], data: content });
      }
    }
    start = next + bBuf.length;
  }
  return parts;
}

/* ─────────────────────────  API handlers  ───────────────────────── */

function apiGetArticoli(res) {
  let out = [];
  try {
    out = fs.readdirSync(ARTICOLI_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const dir = path.join(ARTICOLI_DIR, d.name);
        let info = {};
        try { info = parseTxt(fs.readFileSync(path.join(dir, 'info.txt'), 'utf8')); } catch {}
        return {
          id:        d.name,
          titolo:    info.titolo || d.name,
          categoria: info.categoria || '',
          stato:     info.stato === 'venduto' ? 'venduto' : 'disponibile',
          cover:     hasCover(dir),
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {}
  json(res, out);
}

function apiGetArticolo(res, id) {
  if (!safeId(id)) return badReq(res, 'id non valido');
  const dir = path.join(ARTICOLI_DIR, id);
  if (!fs.existsSync(dir)) return notFound(res);
  let info = {};
  try { info = parseTxt(fs.readFileSync(path.join(dir, 'info.txt'), 'utf8')); } catch {}
  json(res, {
    id,
    titolo:      info.titolo || '',
    categoria:   info.categoria || '',
    descrizione: info.descrizione || '',
    prezzo:      info.prezzo || '',
    stato:       info.stato === 'venduto' ? 'venduto' : 'disponibile',
    foto:        listFoto(dir),
    cover:       hasCover(dir),
  });
}

async function apiPostArticolo(req, res, id) {
  if (!safeId(id)) return badReq(res, 'id non valido');
  const dir = path.join(ARTICOLI_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const f = await readJson(req);
  if (!f) return badReq(res, 'JSON non valido');
  try {
    fs.writeFileSync(path.join(dir, 'info.txt'), buildInfoTxt(f), 'utf8');
    // foto.txt con l'ordine ricevuto (se fornito), escludendo cover.jpg
    if (Array.isArray(f.foto)) {
      const clean = f.foto.filter(n => safeFilename(n) && n.toLowerCase() !== 'cover.jpg');
      fs.writeFileSync(path.join(dir, 'foto.txt'), clean.join('\n') + (clean.length ? '\n' : ''), 'utf8');
    }
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiUploadFoto(req, res, id) {
  if (!safeId(id)) return badReq(res, 'id non valido');
  const dir = path.join(ARTICOLI_DIR, id);
  if (!fs.existsSync(dir)) return notFound(res);
  const buf = await readBodyBuffer(req);
  const parts = parseMultipart(buf, req.headers['content-type']);
  if (!parts.length) return badReq(res, 'nessun file ricevuto');

  const saved = [];
  for (const p of parts) {
    const ext = path.extname(p.filename).toLowerCase();
    if (!IMG_EXT.includes(ext)) continue;
    let base = slugify(path.basename(p.filename, ext)) || 'foto';
    let name = base + ext;
    let n = 1;
    while (fs.existsSync(path.join(dir, name)) || name.toLowerCase() === 'cover.jpg') {
      name = `${base}-${n++}${ext}`;
    }
    fs.writeFileSync(path.join(dir, name), p.data);
    saved.push(name);
  }
  json(res, { ok: true, saved, foto: listFoto(dir) });
}

async function apiSetCover(req, res, id) {
  if (!safeId(id)) return badReq(res, 'id non valido');
  const dir = path.join(ARTICOLI_DIR, id);
  const f = await readJson(req);
  if (!f || !f.filename || !safeFilename(f.filename)) return badReq(res, 'filename mancante');
  const src = path.join(dir, f.filename);
  if (!fs.existsSync(src)) return notFound(res);
  try {
    fs.copyFileSync(src, path.join(dir, 'cover.jpg'));
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

function apiDeleteFoto(res, id, filename) {
  if (!safeId(id) || !safeFilename(filename)) return badReq(res, 'parametri non validi');
  const dir = path.join(ARTICOLI_DIR, id);
  const file = path.join(dir, filename);
  if (!fs.existsSync(file)) return notFound(res);
  try {
    fs.unlinkSync(file);
    // rimuovi da foto.txt
    const fotoTxt = path.join(dir, 'foto.txt');
    if (fs.existsSync(fotoTxt)) {
      const kept = fs.readFileSync(fotoTxt, 'utf8').split('\n')
        .map(l => l.trim()).filter(l => l && l !== filename);
      fs.writeFileSync(fotoTxt, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
    }
    json(res, { ok: true, foto: listFoto(dir) });
  } catch (e) { json(res, { error: e.message }, 500); }
}

function apiDeleteArticolo(res, id) {
  if (!safeId(id)) return badReq(res, 'id non valido');
  const dir = path.join(ARTICOLI_DIR, id);
  if (!fs.existsSync(dir)) return notFound(res);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function apiNuovoArticolo(req, res) {
  const f = await readJson(req);
  if (!f || !f.titolo || !f.titolo.trim()) return badReq(res, 'titolo mancante');
  let base = slugify(f.titolo);
  if (!base) base = 'articolo';
  let id = base, n = 1;
  while (fs.existsSync(path.join(ARTICOLI_DIR, id))) id = `${base}-${n++}`;
  const dir = path.join(ARTICOLI_DIR, id);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'info.txt'),
      buildInfoTxt({ titolo: f.titolo.trim(), stato: 'disponibile' }), 'utf8');
    json(res, { ok: true, id });
  } catch (e) { json(res, { error: e.message }, 500); }
}

function apiGetSito(res) {
  let info = {};
  try { info = parseTxt(fs.readFileSync(SITO_TXT, 'utf8')); } catch {}
  json(res, {
    nome:        info.nome || '',
    sottotitolo: info.sottotitolo || '',
    citta:       info.citta || '',
    email:       info.email || '',
    whatsapp:    info.whatsapp || '',
    note:        info.note || '',
  });
}

async function apiPostSito(req, res) {
  const f = await readJson(req);
  if (!f) return badReq(res, 'JSON non valido');
  try {
    fs.writeFileSync(SITO_TXT, buildSitoTxt(f), 'utf8');
    json(res, { ok: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

function apiPubblica(res) {
  const script = path.join(ROOT, 'pubblica.sh');
  if (!fs.existsSync(script)) return json(res, { ok: false, output: 'pubblica.sh non trovato.' }, 500);
  exec('bash pubblica.sh', { cwd: ROOT, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    const output = (stdout || '') + (stderr ? '\n' + stderr : '');
    json(res, { ok: !err, output: output.trim(), code: err ? err.code : 0 });
  });
}

/* ── Serve immagini delle cartelle articoli (per i thumbnail) ── */
function serveStatic(res, urlPath) {
  const rel = decodeURIComponent(urlPath.replace(/^\//, ''));
  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ARTICOLI_DIR)) return notFound(res);
  fs.readFile(filePath, (err, data) => {
    if (err) return notFound(res);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

/* ─────────────────────────  Router  ───────────────────────── */

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;

  try {
    if (url === '/api/articoli' && method === 'GET')  return apiGetArticoli(res);
    if (url === '/api/articolo/nuovo' && method === 'POST') return apiNuovoArticolo(req, res);
    if (url === '/api/sito' && method === 'GET')  return apiGetSito(res);
    if (url === '/api/sito' && method === 'POST') return apiPostSito(req, res);
    if (url === '/api/pubblica' && method === 'POST') return apiPubblica(res);

    let m;
    if ((m = url.match(/^\/api\/articolo\/([^/]+)\/foto\/([^/]+)$/)) && method === 'DELETE')
      return apiDeleteFoto(res, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    if ((m = url.match(/^\/api\/articolo\/([^/]+)\/foto$/)) && method === 'POST')
      return apiUploadFoto(req, res, decodeURIComponent(m[1]));
    if ((m = url.match(/^\/api\/articolo\/([^/]+)\/cover$/)) && method === 'POST')
      return apiSetCover(req, res, decodeURIComponent(m[1]));
    if ((m = url.match(/^\/api\/articolo\/([^/]+)$/)) && method === 'GET')
      return apiGetArticolo(res, decodeURIComponent(m[1]));
    if ((m = url.match(/^\/api\/articolo\/([^/]+)$/)) && method === 'POST')
      return apiPostArticolo(req, res, decodeURIComponent(m[1]));
    if ((m = url.match(/^\/api\/articolo\/([^/]+)$/)) && method === 'DELETE')
      return apiDeleteArticolo(res, decodeURIComponent(m[1]));

    if (url.startsWith('/articoli/') && method === 'GET') return serveStatic(res, url);

    if ((url === '/' || url === '/index.html') && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(HTML);
    }

    notFound(res);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  let lan = null;
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name]) {
      if (ni.family === 'IPv4' && !ni.internal) { lan = ni.address; break; }
    }
    if (lan) break;
  }
  console.log('┌──────────────────────────────────────────────');
  console.log('│  Editor Liquidazione avviato');
  console.log(`│  Locale:  http://localhost:${PORT}`);
  if (lan) console.log(`│  WiFi:    http://${lan}:${PORT}   (da iPhone stessa rete)`);
  console.log('│  Ctrl+C per fermare');
  console.log('└──────────────────────────────────────────────');
});

/* ─────────────────────────  UI (HTML inline)  ───────────────────────── */

const HTML = /* html */`<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>Editor — Liquidazione</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#111;--surface:#1a1a1a;--surface2:#222;--surface3:#282828;
  --border:#2a2a2a;--text:#f0f0f0;--muted:#888;--muted2:#666;
  --accent:#e8e0d0;--green:#3a7d44;--green-h:#2e6436;
  --red:#cc3333;--red-h:#a82a2a;--radius:10px;
}
html{font-size:15px;-webkit-text-size-adjust:100%}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);
  line-height:1.5;padding-bottom:120px;min-height:100vh}
a{color:inherit;text-decoration:none}
.wrap{max-width:920px;margin:0 auto;padding:20px 16px}
.section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:20px;margin-bottom:20px}
h1{font-size:1.4rem;font-weight:700;letter-spacing:.04em;margin-bottom:4px}
.subtitle{color:var(--muted);font-size:.85rem;margin-bottom:24px}
h2{font-size:.78rem;font-weight:600;color:var(--muted);letter-spacing:.1em;
  text-transform:uppercase;margin-bottom:16px;display:flex;align-items:center;gap:8px}

/* form */
label{display:block;font-size:.72rem;font-weight:500;color:var(--muted);
  letter-spacing:.04em;text-transform:uppercase;margin-bottom:5px}
.field{margin-bottom:16px}
.row{display:flex;gap:12px;flex-wrap:wrap}
.row .field{flex:1;min-width:160px}
input[type=text],textarea,select{width:100%;background:var(--surface2);
  border:1px solid var(--border);border-radius:8px;color:var(--text);
  font-family:inherit;font-size:.92rem;padding:10px 12px;outline:none;transition:border-color .2s}
input:focus,textarea:focus,select:focus{border-color:var(--accent)}
textarea{resize:vertical;min-height:110px;line-height:1.6}
select{-webkit-appearance:none;appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg width='10' height='6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23888' fill='none' stroke-width='1.5'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 14px center}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;
  border:none;border-radius:8px;font-family:inherit;font-size:.88rem;font-weight:600;
  padding:10px 20px;cursor:pointer;transition:background .18s,opacity .18s,transform .1s;
  -webkit-appearance:none}
.btn:active{transform:scale(.97)}
.btn-primary{background:var(--green);color:#fff}
.btn-primary:hover{background:var(--green-h)}
.btn-accent{background:var(--accent);color:#111}
.btn-accent:hover{opacity:.85}
.btn-ghost{background:var(--surface3);color:var(--text);border:1px solid var(--border)}
.btn-ghost:hover{background:var(--border)}
.btn-danger{background:transparent;color:var(--red);border:1px solid var(--red)}
.btn-danger:hover{background:var(--red);color:#fff}
.btn-sm{padding:6px 12px;font-size:.78rem}

/* toast inline */
.toast{display:inline-block;font-size:.8rem;font-weight:500;padding:6px 12px;
  border-radius:6px;margin-left:12px;opacity:0;transition:opacity .2s;vertical-align:middle}
.toast.show{opacity:1}
.toast.ok{background:#16341a;color:#6fcf80}
.toast.err{background:#3a1616;color:#f08080}

/* article grid */
#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px}
.card{background:var(--surface2);border:1px solid var(--border);border-radius:10px;
  overflow:hidden;cursor:pointer;transition:transform .15s,border-color .15s}
.card:hover{transform:translateY(-2px);border-color:var(--accent)}
.card-cover{aspect-ratio:4/3;background:#0d0d0d;position:relative;overflow:hidden;
  display:flex;align-items:center;justify-content:center}
.card-cover img{width:100%;height:100%;object-fit:cover}
.card-cover .nocover{color:var(--muted2);font-size:.75rem}
.card-body{padding:10px 12px}
.card-title{font-size:.88rem;font-weight:600;line-height:1.3;margin-bottom:5px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.card-cat{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.badge{font-size:.62rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  padding:2px 7px;border-radius:4px}
.badge.disp{background:#16341a;color:#6fcf80}
.badge.vend{background:var(--red);color:#fff}

/* photos */
#foto-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;margin-top:8px}
.thumb{position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;background:#0d0d0d;
  border:2px solid transparent;cursor:grab;transition:border-color .15s}
.thumb.cover{border-color:var(--accent)}
.thumb.dragging{opacity:.4}
.thumb.over{border-color:var(--green)}
.thumb img{width:100%;height:100%;object-fit:cover;pointer-events:none}
.thumb-actions{position:absolute;inset:0;background:rgba(0,0,0,.55);opacity:0;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  transition:opacity .15s}
.thumb:hover .thumb-actions,.thumb:focus-within .thumb-actions{opacity:1}
.thumb-actions button{font-size:.7rem;padding:5px 10px;border-radius:5px;border:none;
  cursor:pointer;font-weight:600;font-family:inherit}
.t-cover{background:var(--accent);color:#111}
.t-del{background:var(--red);color:#fff}
.cover-tag{position:absolute;top:4px;left:4px;background:var(--accent);color:#111;
  font-size:.6rem;font-weight:700;padding:2px 6px;border-radius:4px;letter-spacing:.05em}
.upload-tile{aspect-ratio:1;border:2px dashed var(--border);border-radius:8px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  cursor:pointer;color:var(--muted);transition:border-color .15s,color .15s;font-size:.8rem;text-align:center;padding:8px}
.upload-tile:hover{border-color:var(--accent);color:var(--accent)}

/* back link */
.back{display:inline-flex;align-items:center;gap:6px;font-size:.82rem;color:var(--muted);
  margin-bottom:18px;cursor:pointer}
.back:hover{color:var(--accent)}

.divider{height:1px;background:var(--border);margin:24px 0}
.form-footer{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px}
.spacer{flex:1}
.hidden{display:none!important}

/* publish bar */
#publish-bar{position:fixed;left:0;right:0;bottom:0;background:#0c0c0c;
  border-top:1px solid var(--border);padding:12px 16px;z-index:50}
#publish-inner{max-width:920px;margin:0 auto;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
#term{display:none;max-width:920px;margin:10px auto 0;background:#000;border:1px solid var(--border);
  border-radius:8px;padding:12px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:.76rem;line-height:1.55;color:#cfcfcf;max-height:220px;overflow-y:auto;white-space:pre-wrap}
#term .ok-line{color:#6fcf80;font-weight:600}
#term .err-line{color:#f08080;font-weight:600}
.spin{width:14px;height:14px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;
  border-radius:50%;animation:sp .7s linear infinite;display:inline-block}
@keyframes sp{to{transform:rotate(360deg)}}

@media(max-width:560px){
  .wrap{padding:14px 12px}
  .section{padding:16px}
  #grid{grid-template-columns:repeat(2,1fr);gap:10px}
}
</style>
</head>
<body>
<div class="wrap">
  <h1 id="hdr-nome">Editor Liquidazione</h1>
  <div class="subtitle">Gestione contenuti del sito — le modifiche vanno online con “Pubblica”.</div>

  <!-- VISTA LISTA -->
  <div id="view-list">

    <!-- Impostazioni sito -->
    <div class="section">
      <h2>Impostazioni sito</h2>
      <div class="row">
        <div class="field"><label>Nome</label><input type="text" id="s-nome"></div>
        <div class="field"><label>Sottotitolo</label><input type="text" id="s-sottotitolo"></div>
      </div>
      <div class="row">
        <div class="field"><label>Città</label><input type="text" id="s-citta"></div>
        <div class="field"><label>Email</label><input type="text" id="s-email"></div>
        <div class="field"><label>WhatsApp</label><input type="text" id="s-whatsapp" placeholder="+39 333 0000000"></div>
      </div>
      <div class="field"><label>Note</label><input type="text" id="s-note"></div>
      <div class="form-footer">
        <button class="btn btn-accent" onclick="salvaSito()">Salva impostazioni</button>
        <span class="toast" id="toast-sito"></span>
      </div>
    </div>

    <!-- Articoli -->
    <div class="section">
      <h2>Articoli <span style="flex:1"></span>
        <button class="btn btn-primary btn-sm" onclick="nuovoArticolo()">+ Nuovo articolo</button>
      </h2>
      <div id="grid"></div>
    </div>

  </div>

  <!-- VISTA ARTICOLO -->
  <div id="view-edit" class="hidden">
    <div class="back" onclick="tornaLista()">← Torna agli articoli</div>
    <div class="section">
      <h2 id="edit-id-label">Modifica articolo</h2>
      <div class="field"><label>Titolo</label><input type="text" id="a-titolo"></div>
      <div class="row">
        <div class="field"><label>Categoria</label><input type="text" id="a-categoria" placeholder="es. Arredo, Tecnologia"></div>
        <div class="field"><label>Prezzo (opzionale)</label><input type="text" id="a-prezzo" placeholder="es. 350€"></div>
        <div class="field"><label>Stato</label>
          <select id="a-stato"><option value="disponibile">Disponibile</option><option value="venduto">Venduto</option></select>
        </div>
      </div>
      <div class="field"><label>Descrizione</label><textarea id="a-descrizione"></textarea></div>

      <div class="divider"></div>
      <h2>Foto <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted2)">— trascina per riordinare</span></h2>
      <div id="foto-grid"></div>
      <input type="file" id="file-input" multiple accept="image/jpeg,image/png,.jpg,.jpeg,.png" class="hidden">

      <div class="divider"></div>
      <div class="form-footer">
        <button class="btn btn-primary" onclick="salvaArticolo()">Salva articolo</button>
        <span class="toast" id="toast-art"></span>
        <span class="spacer"></span>
        <button class="btn btn-danger" onclick="eliminaArticolo()">Elimina articolo</button>
      </div>
    </div>
  </div>

</div>

<!-- Barra pubblica -->
<div id="publish-bar">
  <div id="publish-inner">
    <button class="btn btn-accent" id="btn-pub" onclick="pubblica()">🚀 Pubblica sito</button>
    <span class="toast" id="toast-pub"></span>
    <span class="spacer"></span>
    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('term').style.display='none'">Nascondi log</button>
  </div>
  <pre id="term"></pre>
</div>

<script>
const $ = s => document.querySelector(s);
let currentId = null;
let fotoState = [];   // ordine corrente delle foto
let coverFrom = null; // nome file scelto come cover (opzionale)

/* ── util ── */
async function api(url, opts){ const r = await fetch(url, opts); return r.json(); }
function toast(el, msg, ok=true){
  const t = $(el); t.textContent = msg; t.className = 'toast show ' + (ok?'ok':'err');
  clearTimeout(t._t); t._t = setTimeout(()=>{ t.className='toast'; }, 2600);
}
function esc(s){ return (s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* ── sito ── */
async function loadSito(){
  const s = await api('/api/sito');
  $('#s-nome').value=s.nome; $('#s-sottotitolo').value=s.sottotitolo;
  $('#s-citta').value=s.citta; $('#s-email').value=s.email;
  $('#s-whatsapp').value=s.whatsapp; $('#s-note').value=s.note;
  if(s.nome) $('#hdr-nome').textContent = s.nome;
}
async function salvaSito(){
  const body = {nome:$('#s-nome').value,sottotitolo:$('#s-sottotitolo').value,
    citta:$('#s-citta').value,email:$('#s-email').value,
    whatsapp:$('#s-whatsapp').value,note:$('#s-note').value};
  const r = await api('/api/sito',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(r.ok){ toast('#toast-sito','Salvato ✓'); if(body.nome) $('#hdr-nome').textContent=body.nome; }
  else toast('#toast-sito','Errore',false);
}

/* ── lista articoli ── */
async function loadArticoli(){
  const list = await api('/api/articoli');
  const g = $('#grid');
  if(!list.length){ g.innerHTML='<div style="color:var(--muted);font-size:.85rem">Nessun articolo. Creane uno con “+ Nuovo articolo”.</div>'; return; }
  g.innerHTML = list.map(a=>{
    const cover = a.cover
      ? \`<img src="/articoli/\${encodeURIComponent(a.id)}/cover.jpg?t=\${Date.now()}">\`
      : '<span class="nocover">nessuna cover</span>';
    const badge = a.stato==='venduto'
      ? '<span class="badge vend">venduto</span>'
      : '<span class="badge disp">disponibile</span>';
    return \`<div class="card" onclick="apriArticolo('\${encodeURIComponent(a.id)}')">
      <div class="card-cover">\${cover}</div>
      <div class="card-body">
        <div class="card-title">\${esc(a.titolo)}</div>
        <div class="card-meta"><span class="card-cat">\${esc(a.categoria)}</span>\${badge}</div>
      </div></div>\`;
  }).join('');
}

async function nuovoArticolo(){
  const titolo = prompt('Titolo del nuovo articolo:');
  if(!titolo || !titolo.trim()) return;
  const r = await api('/api/articolo/nuovo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({titolo})});
  if(r.ok){ await loadArticoli(); apriArticolo(encodeURIComponent(r.id)); }
  else alert('Errore: '+(r.error||'?'));
}

/* ── form articolo ── */
async function apriArticolo(idEnc){
  const id = decodeURIComponent(idEnc);
  const a = await api('/api/articolo/'+encodeURIComponent(id));
  if(a.error){ alert('Articolo non trovato'); return; }
  currentId = id;
  $('#edit-id-label').textContent = 'Modifica — ' + id;
  $('#a-titolo').value=a.titolo; $('#a-categoria').value=a.categoria;
  $('#a-prezzo').value=a.prezzo; $('#a-descrizione').value=a.descrizione;
  $('#a-stato').value=a.stato;
  fotoState = a.foto.slice();
  coverFrom = a.cover ? 'cover.jpg' : null;
  renderFoto();
  $('#view-list').classList.add('hidden');
  $('#view-edit').classList.remove('hidden');
  window.scrollTo(0,0);
}

function tornaLista(){
  $('#view-edit').classList.add('hidden');
  $('#view-list').classList.remove('hidden');
  loadArticoli();
}

function renderFoto(){
  const g = $('#foto-grid');
  const hasCover = coverFrom !== null;
  const tiles = fotoState.map((n,i)=>{
    // la cover è "uguale" a una foto se è stata impostata da quel file: lo evidenziamo se nome combacia
    return \`<div class="thumb" draggable="true" data-name="\${esc(n)}" data-idx="\${i}">
      <img src="/articoli/\${encodeURIComponent(currentId)}/\${encodeURIComponent(n)}?t=\${Date.now()}">
      <div class="thumb-actions">
        <button class="t-cover" onclick="event.stopPropagation();setCover('\${esc(n)}')">★ Cover</button>
        <button class="t-del" onclick="event.stopPropagation();delFoto('\${esc(n)}')">🗑 Elimina</button>
      </div></div>\`;
  }).join('');
  const coverPreview = hasCover
    ? \`<div class="thumb cover" title="Cover attuale">
         <span class="cover-tag">COVER</span>
         <img src="/articoli/\${encodeURIComponent(currentId)}/cover.jpg?t=\${Date.now()}">
       </div>\`
    : '';
  const upload = \`<div class="upload-tile" onclick="$('#file-input').click()">＋<span>Carica foto</span></div>\`;
  g.innerHTML = coverPreview + tiles + upload;
  attachDnd();
}

/* drag & drop reorder */
let dragIdx = null;
function attachDnd(){
  const thumbs = document.querySelectorAll('#foto-grid .thumb[data-idx]');
  thumbs.forEach(t=>{
    t.addEventListener('dragstart', e=>{ dragIdx = +t.dataset.idx; t.classList.add('dragging'); });
    t.addEventListener('dragend',   e=>{ t.classList.remove('dragging'); document.querySelectorAll('.thumb').forEach(x=>x.classList.remove('over')); });
    t.addEventListener('dragover',  e=>{ e.preventDefault(); t.classList.add('over'); });
    t.addEventListener('dragleave', e=>{ t.classList.remove('over'); });
    t.addEventListener('drop', e=>{
      e.preventDefault();
      const to = +t.dataset.idx;
      if(dragIdx===null || dragIdx===to) return;
      const [moved] = fotoState.splice(dragIdx,1);
      fotoState.splice(to,0,moved);
      dragIdx=null; renderFoto();
      toast('#toast-art','Ordine aggiornato — ricorda di salvare', true);
    });
  });
}

async function setCover(name){
  const r = await api('/api/articolo/'+encodeURIComponent(currentId)+'/cover',
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:name})});
  if(r.ok){ coverFrom='cover.jpg'; renderFoto(); toast('#toast-art','Cover impostata ✓'); }
  else toast('#toast-art','Errore cover',false);
}

async function delFoto(name){
  if(!confirm('Eliminare la foto "'+name+'"?')) return;
  const r = await api('/api/articolo/'+encodeURIComponent(currentId)+'/foto/'+encodeURIComponent(name),{method:'DELETE'});
  if(r.ok){ fotoState = r.foto; renderFoto(); toast('#toast-art','Foto eliminata ✓'); }
  else toast('#toast-art','Errore',false);
}

$('#file-input').addEventListener('change', async e=>{
  const files = e.target.files;
  if(!files.length) return;
  const fd = new FormData();
  for(const f of files) fd.append('foto', f, f.name);
  toast('#toast-art','Caricamento…');
  const r = await fetch('/api/articolo/'+encodeURIComponent(currentId)+'/foto',{method:'POST',body:fd}).then(x=>x.json());
  if(r.ok){ fotoState = r.foto; renderFoto(); toast('#toast-art', r.saved.length+' foto caricate ✓'); }
  else toast('#toast-art','Errore upload',false);
  e.target.value='';
});

async function salvaArticolo(){
  const body = {
    titolo:$('#a-titolo').value, categoria:$('#a-categoria').value,
    descrizione:$('#a-descrizione').value, prezzo:$('#a-prezzo').value,
    stato:$('#a-stato').value, foto:fotoState
  };
  const r = await api('/api/articolo/'+encodeURIComponent(currentId),
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(r.ok) toast('#toast-art','Salvato ✓');
  else toast('#toast-art','Errore',false);
}

async function eliminaArticolo(){
  if(!confirm('Eliminare definitivamente l\\'articolo "'+currentId+'" e tutte le sue foto?')) return;
  const r = await api('/api/articolo/'+encodeURIComponent(currentId),{method:'DELETE'});
  if(r.ok){ tornaLista(); }
  else alert('Errore eliminazione');
}

/* ── pubblica ── */
async function pubblica(){
  const btn = $('#btn-pub'), term = $('#term');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Pubblicazione…';
  term.style.display='block'; term.textContent='Esecuzione di pubblica.sh…\\n';
  try{
    const r = await api('/api/pubblica',{method:'POST'});
    const lines = (r.output||'').split('\\n');
    term.innerHTML = lines.map(l=>{
      const cls = /^✓|aggiornato|Sito aggiornato/i.test(l) ? 'ok-line'
                : /error|errore|✗|fatal|rejected/i.test(l) ? 'err-line' : '';
      return cls ? \`<span class="\${cls}">\${esc(l)}</span>\` : esc(l);
    }).join('\\n');
    if(r.ok){ term.innerHTML += '\\n<span class="ok-line">✓ Sito aggiornato</span>'; toast('#toast-pub','Pubblicato ✓'); }
    else { term.innerHTML += '\\n<span class="err-line">✗ Errore — vedi output</span>'; toast('#toast-pub','Errore',false); }
    term.scrollTop = term.scrollHeight;
  }catch(e){
    term.innerHTML += '\\n<span class="err-line">✗ Errore di rete: '+esc(e.message)+'</span>';
    toast('#toast-pub','Errore',false);
  }
  btn.disabled=false; btn.innerHTML='🚀 Pubblica sito';
}

/* ── init ── */
loadSito();
loadArticoli();
</script>
</body>
</html>`;
