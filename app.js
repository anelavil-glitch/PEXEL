'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// INDEXEDDB
// ═══════════════════════════════════════════════════════════════════════════
const DB = (() => {
  const DB_NAME = 'PackingListDB';
  const DB_VER  = 1;
  const STORE   = 'deliveries';
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('deliveryCode', 'deliveryCode', { unique: false });
          s.createIndex('date',         'date',         { unique: false });
        }
      };
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror   = e => rej(e.target.error);
    });
  }

  function getAll() {
    return open().then(db => new Promise((res, rej) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    }));
  }

  function putMany(items) {
    return open().then(db => new Promise((res, rej) => {
      const tx    = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      items.forEach(item => store.put(item));
      tx.oncomplete = () => res(items.length);
      tx.onerror    = e  => rej(e.target.error);
    }));
  }

  function remove(id) {
    return open().then(db => new Promise((res, rej) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
      req.onsuccess = () => res();
      req.onerror   = e  => rej(e.target.error);
    }));
  }

  function clear() {
    return open().then(db => new Promise((res, rej) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
      req.onsuccess = () => res();
      req.onerror   = e  => rej(e.target.error);
    }));
  }

  return { open, getAll, putMany, remove, clear };
})();


// ═══════════════════════════════════════════════════════════════════════════
// PDF PARSER
// ═══════════════════════════════════════════════════════════════════════════
const Parser = (() => {
  const Y_THRESH = 5;

  function groupByY(items) {
    const valid = items.filter(t => t.str && t.str.trim());
    if (!valid.length) return [];
    valid.sort((a, b) => b.transform[5] - a.transform[5]);
    const rows = [];
    let rowY = valid[0].transform[5], current = [];
    for (const item of valid) {
      const y = item.transform[5];
      if (Math.abs(y - rowY) > Y_THRESH) {
        if (current.length) rows.push(current.sort((a,b) => a.transform[4]-b.transform[4]));
        current = []; rowY = y;
      }
      current.push(item);
    }
    if (current.length) rows.push(current.sort((a,b) => a.transform[4]-b.transform[4]));
    return rows;
  }

  function rowText(row) { return row.map(t => t.str).join(' '); }

  function isColHeader(row) {
    const t = rowText(row).toLowerCase();
    return /producto/.test(t) && /cantidad/.test(t);
  }

  function isSecondHeaderRow(row) {
    const t = rowText(row);
    return /\(cm\)/i.test(t) && !/\[[^\]]+\]/.test(t);
  }

  function detectColumns(rows, hdrIdx) {
    const toks = [...rows[hdrIdx]];
    if (hdrIdx + 1 < rows.length && isSecondHeaderRow(rows[hdrIdx + 1])) {
      toks.push(...rows[hdrIdx + 1]);
    }
    const tokens = toks.map(t => ({ str: t.str.trim(), x: t.transform[4] })).filter(t => t.str);
    const cols = {};

    const matchers = [
      [/^producto$/i,             'producto'],
      [/^cant(idad)?\.?$/i,       'cantidad'],
      [/^marca$/i,                'marca'],
      [/^l\s*\(cm\)$/i,           'l'],
      [/^w\s*\(cm\)$/i,           'w'],
      [/^h\s*\(cm\)$/i,           'h'],
      [/^l$/i,                    'l'],
      [/^w$/i,                    'w'],
      [/^h$/i,                    'h'],
      [/^p\.?z\.?x\.?b\.?$/i,     'pzxb'],
      [/^kg$/i,                   'kg'],
      [/^m[²³23]$/i,              'm3'],
      [/^bultos$/i,               'bultos'],
      [/^n[°o][\s\-]?bultos$/i,   'nbultos'],
      [/^n[°o]$/i,                'nbultos'],
      [/^desde$/i,                'ubicacion'],
      [/^ubicaci[oó]n$/i,         'ubicacion'],
    ];

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      for (const [rx, field] of matchers) {
        if (!(field in cols) && rx.test(t.str)) { cols[field] = t.x; break; }
      }
      if (i + 1 < tokens.length) {
        const next    = tokens[i + 1];
        const joined  = t.str + next.str;
        const joinedS = t.str + ' ' + next.str;
        for (const [rx, field] of matchers) {
          if (!(field in cols) && (rx.test(joined) || rx.test(joinedS))) {
            cols[field] = t.x; break;
          }
        }
      }
    }

    if (cols.nbultos !== undefined && cols.bultos !== undefined && cols.nbultos <= cols.bultos) {
      [cols.nbultos, cols.bultos] = [cols.bultos, cols.nbultos];
    }

    const tipo = cols.marca ? 'A (con Marca)' : 'B (sin Marca)';
    console.log(`[Parser] Tipo detectado: ${tipo}`);
    console.log('[Parser] cols:', JSON.stringify(cols));
    // DEBUG: show each header token with its X position
    console.log('[Parser] Header tokens:',
      tokens.map(t => `"${t.str}"@${Math.round(t.x)}`).join('  |  '));
    // DEBUG: show computed zone boundaries
    const _sorted = Object.entries(cols).filter(([f]) => f !== 'producto').sort((a,b)=>a[1]-b[1]);
    const zones = _sorted.map(([f,cx],i)=>{
      const prevCx = i>0?_sorted[i-1][1]:cx-100;
      const nextCx = i<_sorted.length-1?_sorted[i+1][1]:Infinity;
      const left   = (prevCx+cx)/2;
      const right  = nextCx===Infinity?Infinity:cx+(nextCx-cx)*0.70;
      return `${f}:[${Math.round(left)}–${right===Infinity?'∞':Math.round(right)}]`;
    });
    console.log('[Parser] Zones:', zones.join('  '));
    return cols;
  }

  function assignCol(x, cols) {
    // Frontera izquierda = punto medio con la columna anterior
    // Frontera derecha   = cx + 70% del gap hasta la siguiente columna
    //   • Más amplia que el punto medio puro (50%) para capturar números
    //     right-aligned que aparecen cerca del borde derecho de su celda.
    //   • NO llega al encabezado siguiente: evita que números estrechos
    //     de la columna N+1 (que empiezan cerca del borde derecho de N)
    //     sean capturados por la zona N.
    const sorted = Object.entries(cols)
      .filter(([f]) => f !== 'producto')
      .sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < sorted.length; i++) {
      const [field, cx] = sorted[i];
      const prevCx = i > 0 ? sorted[i - 1][1] : cx - 100;
      const nextCx = i < sorted.length - 1 ? sorted[i + 1][1] : Infinity;
      const left  = (prevCx + cx) / 2;
      const right = nextCx === Infinity ? Infinity : cx + (nextCx - cx) * 0.70;
      if (x >= left && x < right) return field;
    }
    return null;
  }

  function isFooterText(text) {
    return /RUC\s*:/i.test(text) ||
           /Zona Libre/i.test(text) ||
           /[Pp]anam[aá]/.test(text) ||
           /S\.A\./.test(text) ||
           /\bDV\s*\d/i.test(text) ||
           /[Cc]alle\s+\d/.test(text) ||
           /\bAv[e.]?\s/i.test(text) ||
           /P[áa]gina\s*:?\s*\d/i.test(text) ||
           /^\s*\d+\s*(de|of|\/)\s*\d+\s*$/i.test(text) ||
           /@[\w.-]+\.\w+/.test(text) ||
           /\(\s*PA\s*\)/i.test(text) ||
           /Zona\s+Industrial/i.test(text) ||
           /Tel[eé]fono|Fax\s*:/i.test(text) ||
           /info\.|www\./i.test(text);
  }

  function parseHeaderMeta(rows) {
    let deliveryCode = '', orderNumber = '', status = '';
    let date = '', seller = '', client = '', warehouse = '';

    for (let i = 0; i < rows.length; i++) {
      const text = rowText(rows[i]);
      const toks = rows[i];

      if (!deliveryCode) {
        const m = text.match(/([A-Z]+\/OUT\/\d+)/);
        if (m) deliveryCode = m[1];
      }

      if (/[Oo]rden\s*:/.test(text)) {
        const ordenTok  = toks.find(t => /[Oo]rden/.test(t.str));
        const estadoTok = toks.find(t => /[Ee]stado/.test(t.str));
        const almacenTok= toks.find(t => /[Aa]lmac[eé]n/.test(t.str));
        if (i + 1 < rows.length) {
          const valRow = rows[i + 1];
          if (ordenTok) {
            const ov = valRow.find(t => Math.abs(t.transform[4] - ordenTok.transform[4]) < 40);
            if (ov) orderNumber = ov.str.trim();
          }
          if (estadoTok) {
            const ev = valRow.find(t => Math.abs(t.transform[4] - estadoTok.transform[4]) < 40);
            if (ev) status = ev.str.trim();
          }
          if (almacenTok) {
            const av = valRow.find(t => Math.abs(t.transform[4] - almacenTok.transform[4]) < 60);
            if (av) warehouse = av.str.trim();
          }
          const fechaTok = valRow.find(t => /\d{2}\/\d{2}\/\d{4}/.test(t.str));
          if (fechaTok) date = fechaTok.str.match(/\d{2}\/\d{2}\/\d{4}/)[0];
        }
      }

      if (!seller && /[Vv]endedor/.test(text)) {
        const lIdx = rows[i].findIndex(t => /[Vv]endedor/.test(t.str));
        if (lIdx >= 0) seller = rows[i].slice(lIdx+1).map(t=>t.str).join(' ').trim();
        if (!seller && i + 1 < rows.length) seller = rowText(rows[i+1]).trim();
      }

      if (!client && /[Cc]liente\s*:/.test(text)) {
        const after = text.replace(/.*[Cc]liente\s*:?\s*/,'').trim();
        if (after) client = after;
        else if (i + 1 < rows.length) client = rowText(rows[i+1]).trim();
      }

      if (!client && /[Dd]irecci[oó]n\s+de\s+entrega/i.test(text)) {
        if (i + 1 < rows.length) client = rowText(rows[i+1]).trim();
      }
    }

    if (!client) {
      for (const row of rows) {
        const t = rowText(row).trim();
        if (!t || /\/OUT\//.test(t) || /[Oo]rden|[Ee]stado|[Ff]echa|[Vv]endedor|[Cc]liente|[Dd]irecci[oó]n/.test(t)) continue;
        if (/[A-Z]{3,}/.test(t) && t.length > 4 && t.length < 80) { client = t; break; }
      }
    }

    return { deliveryCode, orderNumber, warehouse, status, date, seller, client };
  }

  function parseProducts(rows, cols) {
    const products  = [];
    let cur = null, parsedTotals = null;

    function extractCode(str) {
      // El código de producto SOLO puede estar al INICIO de la fila.
      // Los [refs] embebidos en medio de la descripción NO son códigos de producto.
      const m = str.match(/^\s*\[([^\]]+)\]/);
      return m ? m[1] : null;
    }

    function buildDescText(toks) {
      if (!toks.length) return '';
      return toks.reduce((acc, t, i) => {
        if (i === 0) return t.str;
        const prev = acc.slice(-1);
        const sep  = /[-\/]$/.test(prev) || /^[-\/]/.test(t.str) ? '' : ' ';
        return acc + sep + t.str;
      // Solo elimina el [CÓDIGO] inicial; preserva refs cruzadas dentro del texto
      }, '').replace(/^\s*\[[^\]]*\]\s*/, '').trim();
    }

    for (const row of rows) {
      if (isColHeader(row) || isSecondHeaderRow(row)) continue;

      // Cabecera de página repetida (páginas 2-N) y pie de empresa
      const _rt = rowText(row);
      if (/[A-Z]+\/OUT\/\d+/.test(_rt)) continue;
      if (isFooterText(_rt))            continue;

      // ── Clasificar cada token con assignCol ──────────────────────────
      // Tokens cuya columna sea null → descripción
      // El resto → datos
      const descToks = [], dataToks = [];
      for (const t of row) {
        const col = assignCol(t.transform[4], cols);
        if (!col || col === 'producto') descToks.push(t);
        else                            dataToks.push(t);
      }

      const rowStr   = row.map(t => t.str).join('');
      const code     = extractCode(rowStr);
      const hasData  = dataToks.length > 0;
      const descText = buildDescText(descToks);

      // ── Fila de totales ───────────────────────────────────────────────
      if (/^totale?s?[\s:]/i.test(descText) || /^total$/i.test((descText.split(/\s/)[0] || ''))) {
        if (cur) { products.push(cur); cur = null; }
        parsedTotals = {};
        for (const t of dataToks) {
          const col = assignCol(t.transform[4], cols);
          const val = parseFloat(t.str.replace(',', '.'));
          if (col && col !== 'producto' && !isNaN(val)) parsedTotals[col] = val;
        }
        continue;
      }

      // ── Filtrar fila "Unidades" (sola o con referencia cruzada) ─────────
      // Caso simple: solo "Unidades"
      if (/^[Uu]nidades$/.test(rowStr.trim())) continue;
      // Caso compuesto: "[REF-CODE]  Unidades" — todos los dataToks son "Unidades"
      // El [REF-CODE] es una referencia alternativa, no un producto nuevo.
      const onlyUnidades = dataToks.length > 0 &&
                           dataToks.every(t => /^[Uu]nidades$/i.test(t.str.trim()));
      if (onlyUnidades) {
        // Agregar la referencia cruzada a la descripción del producto activo
        if (cur && code) cur.description += (cur.description ? ' ' : '') + `[${code}]`;
        continue;
      }

      // ── Lógica de 4 ramas ─────────────────────────────────────────────
      if (code && hasData) {
        // Fila normal: código + datos en la misma fila
        if (cur) products.push(cur);
        cur = {
          code, description: descText,
          quantity:0, brand:'', l:0, w:0, h:0,
          pzxb:0, kg:0, m3:0, bultos:0, nBultos:'', ubicacion:'',
        };
        applyDataTokens(cur, dataToks, cols);

      } else if (code && !hasData) {
        // Código sin datos: puede ser producto real (datos en fila siguiente)
        // o referencia cruzada en descripción.
        // Las refs cruzadas suelen contener '/' (ej: [17801-0S010/17801-05010]).
        // Los códigos de producto no llevan '/'.
        const codeVal = code.trim();
        const isRealCode = !codeVal.includes('/') && /^[A-Z0-9][A-Z0-9\-\.]+$/i.test(codeVal);
        if (isRealCode) {
          if (cur) products.push(cur);
          cur = {
            code: codeVal, description: descText,
            quantity:0, brand:'', l:0, w:0, h:0,
            pzxb:0, kg:0, m3:0, bultos:0, nBultos:'', ubicacion:'',
          };
        } else {
          // Es referencia cruzada → continuar descripción del producto activo
          if (cur && !isFooterText(descText)) {
            const extra = descText || `[${codeVal}]`;
            cur.description = cur.description ? cur.description + ' ' + extra : extra;
          }
        }

      } else if (!code && hasData && cur) {
        // Datos sin código: solo completa campos aún vacíos (evita que subtotales sobreescriban)
        applyDataTokensSafe(cur, dataToks, cols);

      } else if (cur && descText && !hasData) {
        // Continuación de descripción
        if (!/^[Uu]nidades$/.test(descText) && !isFooterText(descText))
          cur.description = cur.description ? cur.description + '\n' + descText : descText;
      }
    }

    if (cur) products.push(cur);
    Object.defineProperty(products, '_totals', { value: parsedTotals, enumerable: false, writable: true });
    return products;
  }

  function applyDataTokens(cur, rightToks, cols) {
    const nBultosParts = [];
    console.log(`[applyData] code=${cur.code}  tokens:`,
      rightToks.map(t => `"${t.str.trim()}"@${Math.round(t.transform[4])}→${assignCol(t.transform[4],cols)||'?'}`).join('  '));

    for (const t of rightToks) {
      const x   = t.transform[4];
      const str = t.str.trim();
      if (!str) continue;

      const col = assignCol(x, cols);
      if (!col || col === 'producto') continue;
      const num = parseFloat(str.replace(',', '.'));

      switch (col) {
        // First-wins para campos numéricos: el primer token (x más pequeño = número
        // más ancho = más a la izquierda, valor correcto en columnas right-aligned)
        // gana; si un token estrecho de la columna adyacente "se cuela" en esta zona
        // llega después y no sobreescribe el valor ya correcto.
        case 'cantidad':  if (!cur.quantity)  cur.quantity  = isNaN(num) ? 0 : num; break;
        case 'marca':     if (!cur.brand)     cur.brand     = str;                   break;
        case 'l':         if (!cur.l)         cur.l         = isNaN(num) ? 0 : num; break;
        case 'w':         if (!cur.w)         cur.w         = isNaN(num) ? 0 : num; break;
        case 'h':         if (!cur.h)         cur.h         = isNaN(num) ? 0 : num; break;
        case 'pzxb':      if (!cur.pzxb)      cur.pzxb      = isNaN(num) ? 0 : num; break;
        case 'kg':        if (!cur.kg)        cur.kg        = isNaN(num) ? 0 : num; break;
        case 'm3':        if (!cur.m3)        cur.m3        = isNaN(num) ? 0 : num; break;
        case 'bultos':    if (!cur.bultos)    cur.bultos    = isNaN(num) ? 0 : num; break;
        case 'nbultos':
          // N°Bultos = dígitos/guiones ("1","-","4" → "1-4"); texto con letras = Desde
          if (/^[\d\s\-]+$/.test(str)) nBultosParts.push(str);
          else cur.ubicacion = (cur.ubicacion ? cur.ubicacion + ' ' : '') + str;
          break;
        case 'ubicacion': cur.ubicacion = (cur.ubicacion ? cur.ubicacion + ' ' : '') + str; break;
      }
    }
    if (nBultosParts.length) cur.nBultos = nBultosParts.join('');
  }

  // Versión conservadora: solo asigna campos que siguen en su valor inicial.
  // Evita que filas de subtotales/totales sobreescriban datos ya correctos.
  function applyDataTokensSafe(cur, dataToks, cols) {
    const nBultosParts = [];
    for (const t of dataToks) {
      const str = t.str.trim();
      if (!str) continue;
      const col = assignCol(t.transform[4], cols);
      if (!col || col === 'producto') continue;
      const num = parseFloat(str.replace(',', '.'));
      switch (col) {
        case 'cantidad': if (!cur.quantity)  cur.quantity = isNaN(num) ? 0 : num; break;
        case 'marca':    if (!cur.brand)     cur.brand    = str;                   break;
        case 'l':        if (!cur.l)         cur.l        = isNaN(num) ? 0 : num; break;
        case 'w':        if (!cur.w)         cur.w        = isNaN(num) ? 0 : num; break;
        case 'h':        if (!cur.h)         cur.h        = isNaN(num) ? 0 : num; break;
        case 'pzxb':     if (!cur.pzxb)      cur.pzxb     = isNaN(num) ? 0 : num; break;
        case 'kg':       if (!cur.kg)        cur.kg       = isNaN(num) ? 0 : num; break;
        case 'm3':       if (!cur.m3)        cur.m3       = isNaN(num) ? 0 : num; break;
        case 'bultos':   if (!cur.bultos)    cur.bultos   = isNaN(num) ? 0 : num; break;
        case 'nbultos':
          if (/^[\d\s\-]+$/.test(str)) { if (!cur.nBultos) nBultosParts.push(str); }
          else                          { if (!cur.ubicacion) cur.ubicacion = str; }
          break;
        case 'ubicacion': if (!cur.ubicacion) cur.ubicacion = str; break;
      }
    }
    if (nBultosParts.length && !cur.nBultos) cur.nBultos = nBultosParts.join('');
  }

  async function parsePDF(arrayBuffer, filename) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    console.log(`[Parser] "${filename}" → ${pdf.numPages} página(s)`);

    const allTokens = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const vp      = page.getViewport({ scale: 1 });
      const yOffset = (1 - p) * vp.height;
      const tc      = await page.getTextContent();
      for (const item of tc.items) {
        allTokens.push({
          ...item,
          transform: [
            item.transform[0], item.transform[1],
            item.transform[2], item.transform[3],
            item.transform[4],
            item.transform[5] + yOffset,
          ],
        });
      }
    }

    // Une filas donde el código viene partido en dos Y distintos: "[MU1314-" + "FILTRO]"
    function mergeCodeSplitRows(rawRows) {
      const out = [];
      for (let i = 0; i < rawRows.length; i++) {
        const s = rowText(rawRows[i]);
        if (i < rawRows.length - 1 && s.includes('[') && !s.includes(']') &&
            rowText(rawRows[i + 1]).includes(']')) {
          out.push([...rawRows[i], ...rawRows[i + 1]].sort((a, b) => a.transform[4] - b.transform[4]));
          i++;
        } else {
          out.push(rawRows[i]);
        }
      }
      return out;
    }

    const rows = mergeCodeSplitRows(groupByY(allTokens));
    console.log(`[Parser] ${rows.length} filas agrupadas`);

    // Nueva sección solo cuando el código de entrega CAMBIA.
    // Así un PDF de 4 páginas con el mismo código no genera 4 entregas separadas.
    const secStarts = [];
    let lastSecCode = null;
    rows.forEach((row, i) => {
      const m = rowText(row).match(/([A-Z]+\/OUT\/\d+)/);
      if (m && m[1] !== lastSecCode) { secStarts.push(i); lastSecCode = m[1]; }
    });
    if (!secStarts.length) {
      console.warn('[Parser] Sin patrón XX/OUT/NNNNN — parseo completo');
      secStarts.push(0);
    }

    const deliveries = [];

    for (let s = 0; s < secStarts.length; s++) {
      const secRows = rows.slice(secStarts[s], secStarts[s+1] ?? rows.length);

      let colHdrIdx = -1;
      for (let i = 0; i < Math.min(secRows.length, 40); i++) {
        if (isColHeader(secRows[i])) { colHdrIdx = i; break; }
      }
      if (colHdrIdx === -1) {
        console.warn(`[Parser] Sección ${s}: no se encontró cabecera de columnas`);
        continue;
      }

      const cols = detectColumns(secRows, colHdrIdx);
      const meta = parseHeaderMeta(secRows.slice(0, colHdrIdx));

      const hasSecondHdr = colHdrIdx + 1 < secRows.length && isSecondHeaderRow(secRows[colHdrIdx + 1]);
      const afterHdr     = colHdrIdx + 1 + (hasSecondHdr ? 1 : 0);

      const products = parseProducts(secRows.slice(afterHdr), cols);
      const code     = meta.deliveryCode || `DELIVERY-${s}-${Date.now()}`;

      // ── Detección de tipo de PL y empresa ────────────────────────────────
      let plTipo = 1, empresa = 'PERFECT PTY';
      if (/^WH\/OUT\//i.test(code) || !cols.marca) {
        plTipo  = 2;
        empresa = 'Parque del Mar';
      }
      console.log(`[Parser] "${code}" → Tipo ${plTipo} (${empresa}): ${products.length} producto(s)`);

      deliveries.push({
        id:           code,
        deliveryCode: code,
        plTipo,
        empresa,
        orderNumber:  meta.orderNumber,
        warehouse:    meta.warehouse,
        status:       meta.status,
        date:         meta.date,
        seller:       meta.seller,
        client:       meta.client,
        sourceFile:   filename,
        loadedAt:     new Date().toISOString(),
        products,
        totals:       products._totals || null,
      });
    }

    return deliveries;
  }

  return { parsePDF, groupByY, detectColumns };
})();


// ═══════════════════════════════════════════════════════════════════════════
// EXCEL EXPORT
// ═══════════════════════════════════════════════════════════════════════════
const Exporter = (() => {
  const C = {
    BLUE:      '1A56DB', BLUE_DARK: '1E429F', BLUE_LITE: 'DBEAFE',
    GRAY:      'F3F4F6', WHITE:     'FFFFFF',  BLACK:     '111827',
    BORDER:    'E5E7EB',
  };

  const border = {
    top:    { style: 'thin', color: { rgb: C.BORDER } },
    bottom: { style: 'thin', color: { rgb: C.BORDER } },
    left:   { style: 'thin', color: { rgb: C.BORDER } },
    right:  { style: 'thin', color: { rgb: C.BORDER } },
  };

  function st(font, fillColor, halign) {
    return {
      font:      { sz: 10, color: { rgb: C.BLACK }, ...font },
      fill:      fillColor ? { patternType: 'solid', fgColor: { rgb: fillColor } } : { patternType: 'none' },
      alignment: { vertical: 'center', wrapText: true, horizontal: halign || 'left' },
      border,
    };
  }

  const S = {
    hdr:     st({ bold: true, sz: 12, color: { rgb: C.WHITE } }, C.BLUE,      'center'),
    metaKey: st({ bold: true, sz: 10, color: { rgb: C.BLUE_DARK } }, C.BLUE_LITE),
    metaVal: st({ sz: 10 }, C.BLUE_LITE),
    colHdr:  st({ bold: true, sz: 10, color: { rgb: C.WHITE } }, C.BLUE_DARK, 'center'),
    rowOdd:  st({ sz: 10 }, null),
    rowEven: st({ sz: 10 }, C.GRAY),
    numOdd:  st({ sz: 10 }, null,   'right'),
    numEven: st({ sz: 10 }, C.GRAY, 'right'),
    tot:     st({ bold: true, sz: 10 }, C.GRAY, 'right'),
    totLbl:  st({ bold: true, sz: 10 }, C.GRAY),
    blank:   st({ sz: 10 }, null),
  };

  const c = (v, t, s) => ({
    v: v ?? '',
    t: t || (typeof v === 'number' ? 'n' : 's'),
    s: s || S.rowOdd,
  });

  function makeSheet(wb, name, rows, colWidths, merges) {
    const ws = {};
    let maxR = 0, maxC = 0;
    rows.forEach((row, r) => {
      row.forEach((cell, col) => {
        ws[XLSX.utils.encode_cell({ r, c: col })] =
          (cell && typeof cell === 'object' && 'v' in cell) ? cell : c(cell == null ? '' : cell);
        maxC = Math.max(maxC, col + 1);
      });
      maxR = r + 1;
    });
    ws['!ref']  = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:maxR-1,c:maxC-1} });
    ws['!cols'] = (colWidths || []).map(w => ({ wch: w }));
    if (merges) ws['!merges'] = merges;
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  function sheetVistaPDF(wb, deliveries) {
    const HDR = ['Código','Descripción','Cantidad','Marca','L (cm)','W (cm)','H (cm)',
                 'PZxB','kg','m³','Bultos','N° Bultos','Ubicación'];
    const W   = [14, 42, 9, 10, 7, 7, 7, 7, 8, 9, 8, 13, 18];
    const NC  = HDR.length;
    const rows = [], merges = [];

    deliveries.forEach(d => {
      const base = rows.length;
      rows.push(Array.from({ length: NC }, (_, i) => c(i === 0 ? d.deliveryCode : '', 's', S.hdr)));
      merges.push({ s:{r:base,c:0}, e:{r:base,c:NC-1} });

      const meta = [
        [['Tipo PL', `Tipo ${d.plTipo||1} · ${d.empresa||'PERFECT PTY'}`], ['Orden', d.orderNumber], ['Almacén', d.warehouse]],
        [['Estado', d.status],     ['Fecha', d.date],     ['Vendedor', d.seller]],
        [['Cliente', d.client],    ['Archivo', d.sourceFile]],
      ];
      meta.forEach(pairs => {
        const row = Array(NC).fill(c('', 's', S.metaVal));
        let ci = 0;
        pairs.forEach(([k, v]) => {
          row[ci]   = c(k + ':',   's', S.metaKey);
          row[ci+1] = c(v || '—', 's', S.metaVal);
          ci += 4;
        });
        rows.push(row);
      });

      rows.push(HDR.map(h => c(h, 's', S.colHdr)));

      d.products.forEach((p, pi) => {
        const even = pi % 2 !== 0;
        const ts   = even ? S.rowEven : S.rowOdd;
        const ns   = even ? S.numEven : S.numOdd;
        rows.push([
          c(`[${p.code}]`, 's', st({ bold:true, sz:10, color:{rgb:C.BLUE} }, even ? C.GRAY : null)),
          c(p.description || '', 's', st({ sz:9 }, even ? C.GRAY : null)),
          c(p.quantity, 'n', ns),
          c(p.brand   || '', 's', ts),
          c(p.l, 'n', ns), c(p.w, 'n', ns), c(p.h,  'n', ns),
          c(p.pzxb,'n', ns), c(p.kg,'n', ns), c(p.m3,'n', ns),
          c(p.bultos, 'n', ns),
          c(p.nBultos   || '', 's', ts),
          c(p.ubicacion || '', 's', ts),
        ]);
      });

      const tot  = calcTotals(d.products);
      const totR = Array(NC).fill(c('', 's', S.tot));
      totR[0]  = c('TOTAL', 's', S.totLbl);
      totR[2]  = c(tot.quantity, 'n', S.tot);
      totR[8]  = c(tot.kg,      'n', S.tot);
      totR[9]  = c(tot.m3,      'n', S.tot);
      totR[10] = c(tot.bultos,  'n', S.tot);
      rows.push(totR);
      rows.push(Array(NC).fill(c('', 's', S.blank)));
    });

    makeSheet(wb, 'Vista PDF', rows, W, merges);
  }

  function sheetResumen(wb, deliveries) {
    const rows = [];
    rows.push(['Tipo PL','Empresa','Código Entrega','Orden','Fecha','Cliente','Almacén','Estado',
               'Productos','Cant. Total','kg Total','m³ Total','Bultos Total']
      .map(h => c(h, 's', S.colHdr)));

    let gQty=0, gKg=0, gM3=0, gBultos=0;
    deliveries.forEach((d, i) => {
      const tot = calcTotals(d.products);
      gQty += tot.quantity; gKg += tot.kg; gM3 += tot.m3; gBultos += tot.bultos;
      const ts = i%2 ? S.rowEven : S.rowOdd;
      const ns = i%2 ? S.numEven : S.numOdd;
      rows.push([
        c(`Tipo ${d.plTipo||1}`,'s',ts), c(d.empresa||'PERFECT PTY','s',ts),
        c(d.deliveryCode,'s',ts), c(d.orderNumber,'s',ts),
        c(d.date,'s',ts),         c(d.client,'s',ts),
        c(d.warehouse,'s',ts),    c(d.status,'s',ts),
        c(d.products.length,'n',ns),
        c(tot.quantity,'n',ns), c(tot.kg,'n',ns), c(tot.m3,'n',ns), c(tot.bultos,'n',ns),
      ]);
    });
    rows.push([
      c('TOTAL GENERAL','s',S.totLbl),
      ...Array(7).fill(c('','s',S.tot)),
      c(deliveries.reduce((a,d)=>a+d.products.length,0),'n',S.tot),
      c(gQty,'n',S.tot), c(gKg,'n',S.tot), c(gM3,'n',S.tot), c(gBultos,'n',S.tot),
    ]);
    rows.push(Array(13).fill(c('','s',S.blank)));

    rows.push(['Marca','Líneas','Cant. Total','kg Total','m³ Total'].map(h => c(h,'s',S.colHdr)));
    const byBrand = {};
    deliveries.forEach(d => d.products.forEach(p => {
      const b = p.brand || 'Sin marca';
      if (!byBrand[b]) byBrand[b] = { lines:0, qty:0, kg:0, m3:0 };
      byBrand[b].lines++; byBrand[b].qty += p.quantity;
      byBrand[b].kg += p.kg; byBrand[b].m3 += p.m3;
    }));
    Object.entries(byBrand).forEach(([brand, v], i) => {
      const ts = i%2 ? S.rowEven : S.rowOdd;
      const ns = i%2 ? S.numEven : S.numOdd;
      rows.push([c(brand,'s',ts), c(v.lines,'n',ns), c(v.qty,'n',ns), c(v.kg,'n',ns), c(v.m3,'n',ns)]);
    });

    makeSheet(wb, 'Resumen', rows, [8,18,24,13,11,22,16,11,10,13,10,10,13]);
  }

  function sheetDB(wb, deliveries) {
    const HDR = [
      'Tipo PL','Empresa','Archivo','Código Entrega','Orden','Almacén','Estado','Fecha','Vendedor','Cliente',
      'Cód. Producto','Descripción','Cantidad','Marca',
      'L (cm)','W (cm)','H (cm)','PZxB','kg','m³','Bultos','N° Bultos','Ubicación',
    ];
    const rows = [HDR.map(h => c(h,'s',S.colHdr))];
    let rIdx = 0;
    deliveries.forEach(d => {
      d.products.forEach(p => {
        const ts = rIdx%2 ? S.rowEven : S.rowOdd;
        const ns = rIdx%2 ? S.numEven : S.numOdd;
        rows.push([
          c(`Tipo ${d.plTipo||1}`,'s',ts), c(d.empresa||'PERFECT PTY','s',ts),
          c(d.sourceFile,'s',ts),   c(d.deliveryCode,'s',ts),
          c(d.orderNumber,'s',ts),  c(d.warehouse,'s',ts),
          c(d.status,'s',ts),       c(d.date,'s',ts),
          c(d.seller,'s',ts),       c(d.client,'s',ts),
          c(p.code,'s', st({bold:true,sz:10,color:{rgb:C.BLUE}}, rIdx%2?C.GRAY:null)),
          c(p.description||'','s',ts),
          c(p.quantity,'n',ns), c(p.brand||'','s',ts),
          c(p.l,'n',ns), c(p.w,'n',ns), c(p.h,'n',ns),
          c(p.pzxb,'n',ns), c(p.kg,'n',ns), c(p.m3,'n',ns),
          c(p.bultos,'n',ns),
          c(p.nBultos||'','s',ts),
          c(p.ubicacion||'','s',ts),
        ]);
        rIdx++;
      });
    });
    makeSheet(wb, 'Base de datos', rows,
      [8,18,22,18,11,15,10,11,17,24,13,42,9,10,7,7,7,7,8,9,8,13,18]);
  }

  function exportToExcel(deliveries) {
    if (!deliveries.length) { notify('No hay datos para exportar', 'error'); return; }
    const wb = XLSX.utils.book_new();
    wb.Props = { Title: 'Packing List Manager', Author: 'PERFECT PTY' };
    sheetVistaPDF(wb, deliveries);
    sheetResumen(wb, deliveries);
    sheetDB(wb, deliveries);
    const d   = new Date();
    const tag = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    XLSX.writeFile(wb, `PackingList_${tag}.xlsx`);
    notify('Excel exportado correctamente ✓', 'success');
  }

  return { exportToExcel };
})();


// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════
function calcTotals(products) {
  return (products || []).reduce((a, p) => ({
    quantity: a.quantity + (p.quantity || 0),
    kg:       a.kg       + (p.kg       || 0),
    m3:       a.m3       + (p.m3       || 0),
    bultos:   a.bultos   + (p.bultos   || 0),
  }), { quantity: 0, kg: 0, m3: 0, bultos: 0 });
}

function fmt(n, dec = 2) {
  const num = parseFloat(n);
  if (isNaN(num)) return '';
  return num.toLocaleString('es-PA', { minimumFractionDigits: 0, maximumFractionDigits: dec });
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function brandBadge(brand) {
  const b = (brand || '').toUpperCase();
  if (b.includes('PERFECT')) return `<span class="badge badge-perfect">${esc(brand)}</span>`;
  if (b.includes('NATSUKI')) return `<span class="badge badge-natsuki">${esc(brand)}</span>`;
  return brand ? `<span class="badge">${esc(brand)}</span>` : '';
}

function notify(msg, type = 'info') {
  const box = document.getElementById('notifications');
  const el  = document.createElement('div');
  el.className = `notif notif-${type}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  el.innerHTML = `<span style="font-size:16px">${icon}</span><span>${esc(msg)}</span>`;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}


// ═══════════════════════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════════════════════
const App = {
  deliveries:  [],
  currentView: 'upload',
  sortCol:     null,
  sortDir:     'asc',

  async init() {
    if ('serviceWorker' in navigator)
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    try {
      const saved = await DB.getAll();
      if (saved.length) {
        this.deliveries = saved;
        notify(`${saved.length} entrega(s) restaurada(s) desde BD local`, 'info');
      }
    } catch (e) { console.warn('IndexedDB no disponible:', e.message); }

    this.bindNav();
    this.bindUpload();
    this.bindFilters();
    document.getElementById('btn-export-excel')
      .addEventListener('click', () => Exporter.exportToExcel(this.deliveries));
    document.getElementById('btn-clear-db')
      .addEventListener('click', () => this.clearDB());
    this.renderCurrentView();
  },

  bindNav() {
    document.querySelectorAll('.nav-tabs button').forEach(btn =>
      btn.addEventListener('click', () => this.setView(btn.dataset.view)));
  },

  setView(view) {
    this.currentView = view;
    document.querySelectorAll('.nav-tabs button').forEach(b =>
      b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(v =>
      v.classList.toggle('active', v.id === `view-${view}`));
    this.renderCurrentView();
  },

  renderCurrentView() {
    switch (this.currentView) {
      case 'upload':   this.renderUpload();   break;
      case 'pdf-view': this.renderPDFView();  break;
      case 'summary':  this.renderSummary();  break;
      case 'database': this.renderDatabase(); break;
    }
  },

  bindUpload() {
    const dz  = document.getElementById('dropzone');
    const inp = document.getElementById('file-input');
    dz.addEventListener('click', e => {
      if (e.target === dz || e.target.closest('#dropzone') === dz) inp.click();
    });
    document.getElementById('btn-select-file')
      .addEventListener('click', e => { e.stopPropagation(); inp.click(); });
    document.getElementById('btn-test-data')
      .addEventListener('click', e => { e.stopPropagation(); this.loadTestData(); });
    inp.addEventListener('change', e => {
      const files = Array.from(e.target.files);
      if (files.length) this.processFiles(files);
      inp.value = '';
    });
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.pdf'));
      if (files.length) this.processFiles(files);
    });
  },

  async processFiles(files) {
    const area = document.getElementById('progress-area');
    area.innerHTML = `<div class="progress-wrap">
      <div class="progress-label" id="prog-label">Iniciando…</div>
      <div class="progress-bar"><div class="progress-bar-fill" id="prog-fill" style="width:0%"></div></div>
    </div>`;

    const added = [];
    for (let i = 0; i < files.length; i++) {
      document.getElementById('prog-label').textContent = `Procesando ${i+1}/${files.length}: ${files[i].name}`;
      document.getElementById('prog-fill').style.width  = `${Math.round((i/files.length)*100)}%`;
      try {
        const buf  = await files[i].arrayBuffer();
        const devs = await Parser.parsePDF(buf, files[i].name);
        added.push(...devs);
        notify(`${files[i].name}: ${devs.length} entrega(s)`, devs.length ? 'success' : 'error');
      } catch (err) {
        console.error(err);
        notify(`Error en "${files[i].name}": ${err.message}`, 'error');
      }
    }
    document.getElementById('prog-fill').style.width = '100%';
    setTimeout(() => { area.innerHTML = ''; }, 1400);

    if (added.length) {
      const map = Object.fromEntries(this.deliveries.map(d => [d.id, d]));
      added.forEach(d => { map[d.id] = d; });
      this.deliveries = Object.values(map);
      try { await DB.putMany(added); } catch (_) {}
      notify(`${added.length} entrega(s) guardada(s)`, 'success');
    }
    this.renderCurrentView();
    this.renderUpload();
  },

  renderUpload() {
    document.getElementById('delivery-count').textContent = `${this.deliveries.length} entrega(s)`;
    const wrap = document.getElementById('recent-list-wrap');
    if (!this.deliveries.length) {
      wrap.innerHTML = `<div class="empty-state">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/>
        </svg>
        <h3>Sin entregas cargadas</h3><p>Cargá un PDF para empezar</p>
      </div>`;
      return;
    }
    wrap.innerHTML = `<div class="recent-list">${
      this.deliveries.map(d => {
        const tot = calcTotals(d.products);
        return `<div class="recent-item">
          <div class="ri-icon">📦</div>
          <div class="ri-info">
            <div class="ri-name">${esc(d.deliveryCode)}</div>
            <div class="ri-meta">
              <span class="badge badge-tipo${d.plTipo||1}" style="font-size:10px">T${d.plTipo||1}·${esc(d.empresa||'PERFECT PTY')}</span>
              ${esc(d.client||'')} · ${esc(d.date||'—')} · ${d.products.length} prod. · ${fmt(tot.kg,1)} kg
            </div>
          </div>
          <button class="ri-del" data-id="${esc(d.id)}" title="Eliminar">✕</button>
        </div>`;
      }).join('')
    }</div>`;
    wrap.querySelectorAll('.ri-del').forEach(btn =>
      btn.addEventListener('click', () => this.deleteDelivery(btn.dataset.id)));
  },

  async deleteDelivery(id) {
    this.deliveries = this.deliveries.filter(d => d.id !== id);
    try { await DB.remove(id); } catch (_) {}
    notify('Entrega eliminada', 'info');
    this.renderCurrentView();
    if (this.currentView !== 'upload') this.renderUpload();
  },

  async clearDB() {
    if (!confirm('¿Eliminar TODAS las entregas?')) return;
    this.deliveries = [];
    try { await DB.clear(); } catch (_) {}
    notify('Base de datos vaciada', 'info');
    this.renderCurrentView();
    this.renderUpload();
  },

  renderPDFView() {
    const root = document.getElementById('pdf-view-content');
    if (!this.deliveries.length) {
      root.innerHTML = `<div class="empty-state"><h3>No hay entregas para mostrar</h3><p>Cargá un PDF primero</p></div>`;
      return;
    }
    root.innerHTML = this.deliveries.map(d => {
      const tot = calcTotals(d.products);
      return `<div class="delivery-card">
        <div class="delivery-header">
          <div>
            <div class="delivery-code">${esc(d.deliveryCode)}</div>
            <div style="font-size:12px;opacity:.8;margin-top:4px">
              <span class="badge badge-tipo${d.plTipo||1}">Tipo ${d.plTipo||1} · ${esc(d.empresa||'PERFECT PTY')}</span>
              &nbsp;${esc(d.sourceFile||'')}
            </div>
          </div>
          <div style="font-size:12px;opacity:.8;text-align:right">Cargado: ${new Date(d.loadedAt).toLocaleDateString('es-PA')}</div>
        </div>
        <div class="delivery-meta">
          <div><span>Orden: </span><strong>${esc(d.orderNumber||'—')}</strong></div>
          <div><span>Almacén: </span><strong>${esc(d.warehouse||'—')}</strong></div>
          <div><span>Estado: </span><strong>${esc(d.status||'—')}</strong></div>
          <div><span>Fecha: </span><strong>${esc(d.date||'—')}</strong></div>
          <div><span>Vendedor: </span><strong>${esc(d.seller||'—')}</strong></div>
          <div><span>Cliente: </span><strong>${esc(d.client||'—')}</strong></div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr>
            <th class="td-product">Producto</th>
            <th class="td-num">Cantidad</th><th>Marca</th>
            <th class="td-num">L (cm)</th><th class="td-num">W (cm)</th><th class="td-num">H (cm)</th>
            <th class="td-num">PZxB</th><th class="td-num">kg</th><th class="td-num">m³</th>
            <th class="td-num">Bultos</th><th>N° Bultos</th><th>Ubicación</th>
          </tr></thead>
          <tbody>${d.products.map(p => `<tr>
            <td class="td-product">
              <div class="product-code">[${esc(p.code)}]</div>
              <div class="product-desc">${esc(p.description||'')}</div>
            </td>
            <td class="td-num">${fmt(p.quantity,0)}</td>
            <td>${brandBadge(p.brand)}</td>
            <td class="td-num">${fmt(p.l,1)}</td><td class="td-num">${fmt(p.w,1)}</td><td class="td-num">${fmt(p.h,1)}</td>
            <td class="td-num">${fmt(p.pzxb,0)}</td><td class="td-num">${fmt(p.kg,2)}</td><td class="td-num">${fmt(p.m3,4)}</td>
            <td class="td-num">${fmt(p.bultos,0)}</td>
            <td>${esc(p.nBultos||'')}</td>
            <td>${esc(p.ubicacion||'')}</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr>
            <td><strong>TOTALES (${d.products.length} productos)</strong></td>
            <td class="td-num">${fmt(tot.quantity,0)}</td>
            <td colspan="5"></td>
            <td class="td-num">${fmt(tot.kg,2)}</td><td class="td-num">${fmt(tot.m3,4)}</td>
            <td class="td-num">${fmt(tot.bultos,0)}</td><td colspan="2"></td>
          </tr></tfoot>
        </table></div>
      </div>`;
    }).join('');
  },

  renderSummary() {
    const root = document.getElementById('summary-content');
    if (!this.deliveries.length) {
      root.innerHTML = `<div class="empty-state"><h3>Sin datos para resumir</h3><p>Cargá al menos un PDF</p></div>`;
      return;
    }
    const allProds = this.deliveries.flatMap(d => d.products);
    const grand    = calcTotals(allProds);
    const byBrand  = {};
    allProds.forEach(p => {
      const b = p.brand || 'Sin marca';
      if (!byBrand[b]) byBrand[b] = { count:0, qty:0, kg:0, m3:0, bultos:0 };
      byBrand[b].count++; byBrand[b].qty += p.quantity;
      byBrand[b].kg += p.kg; byBrand[b].m3 += p.m3; byBrand[b].bultos += p.bultos;
    });
    const t1 = this.deliveries.filter(d => (d.plTipo||1) === 1);
    const t2 = this.deliveries.filter(d => (d.plTipo||1) === 2);
    root.innerHTML = `
    <div class="stats-bar">
      <div class="stat-card"><div class="stat-value">${this.deliveries.length}</div><div class="stat-label">Entregas</div></div>
      <div class="stat-card"><div class="stat-value" style="color:#1e3a8a">${t1.length}</div><div class="stat-label">T1 · PERFECT PTY</div></div>
      <div class="stat-card"><div class="stat-value" style="color:#713f12">${t2.length}</div><div class="stat-label">T2 · Parque del Mar</div></div>
      <div class="stat-card"><div class="stat-value">${allProds.length}</div><div class="stat-label">Líneas de producto</div></div>
      <div class="stat-card"><div class="stat-value">${fmt(grand.quantity,0)}</div><div class="stat-label">Unidades totales</div></div>
      <div class="stat-card"><div class="stat-value">${fmt(grand.kg,0)}</div><div class="stat-label">kg totales</div></div>
      <div class="stat-card"><div class="stat-value">${fmt(grand.m3,3)}</div><div class="stat-label">m³ totales</div></div>
      <div class="stat-card"><div class="stat-value">${fmt(grand.bultos,0)}</div><div class="stat-label">Bultos totales</div></div>
    </div>
    <div class="summary-grid">
      <div class="card">
        <div class="card-title">Por entrega</div>
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Tipo</th><th>Empresa</th><th>Código Entrega</th><th>Fecha</th><th>Cliente</th>
            <th class="td-num">Prods.</th><th class="td-num">Cant.</th>
            <th class="td-num">kg</th><th class="td-num">m³</th><th class="td-num">Bultos</th>
          </tr></thead>
          <tbody>${this.deliveries.map(d => {
            const t    = calcTotals(d.products);
            const tipo = d.plTipo || 1;
            return `<tr>
              <td style="text-align:center"><span class="badge badge-tipo${tipo}" style="font-size:11px">T${tipo}</span></td>
              <td style="font-size:11px;white-space:nowrap">${esc(d.empresa||'PERFECT PTY')}</td>
              <td><strong>${esc(d.deliveryCode)}</strong></td>
              <td>${esc(d.date||'—')}</td><td>${esc(d.client||'—')}</td>
              <td class="td-num">${d.products.length}</td>
              <td class="td-num">${fmt(t.quantity,0)}</td>
              <td class="td-num">${fmt(t.kg,2)}</td>
              <td class="td-num">${fmt(t.m3,4)}</td>
              <td class="td-num">${fmt(t.bultos,0)}</td>
            </tr>`;
          }).join('')}</tbody>
          <tfoot><tr>
            <td colspan="5"><strong>TOTAL</strong></td>
            <td class="td-num"><strong>${allProds.length}</strong></td>
            <td class="td-num"><strong>${fmt(grand.quantity,0)}</strong></td>
            <td class="td-num"><strong>${fmt(grand.kg,2)}</strong></td>
            <td class="td-num"><strong>${fmt(grand.m3,4)}</strong></td>
            <td class="td-num"><strong>${fmt(grand.bultos,0)}</strong></td>
          </tr></tfoot>
        </table></div>
      </div>
      <div class="card">
        <div class="card-title">Por marca</div>
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Marca</th><th class="td-num">Líneas</th>
            <th class="td-num">Cant.</th><th class="td-num">kg</th><th class="td-num">m³</th>
          </tr></thead>
          <tbody>${Object.entries(byBrand).map(([brand, v]) => `<tr>
            <td>${brandBadge(brand)}</td>
            <td class="td-num">${v.count}</td>
            <td class="td-num">${fmt(v.qty,0)}</td>
            <td class="td-num">${fmt(v.kg,2)}</td>
            <td class="td-num">${fmt(v.m3,4)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>`;
  },

  bindFilters() {
    ['filter-date-from','filter-date-to','filter-code','filter-tipo','filter-brand','filter-search']
      .forEach(id => {
        document.getElementById(id).addEventListener('input',  () => this.renderDatabase());
        document.getElementById(id).addEventListener('change', () => this.renderDatabase());
      });
    document.getElementById('btn-clear-filters').addEventListener('click', () => {
      ['filter-date-from','filter-date-to','filter-code','filter-search']
        .forEach(id => { document.getElementById(id).value = ''; });
      document.getElementById('filter-tipo').value  = '';
      document.getElementById('filter-brand').value = '';
      this.sortCol = null;
      this.renderDatabase();
    });
  },

  getFilters() {
    return {
      from:   document.getElementById('filter-date-from').value,
      to:     document.getElementById('filter-date-to').value,
      code:   document.getElementById('filter-code').value.trim().toLowerCase(),
      tipo:   document.getElementById('filter-tipo').value,
      brand:  document.getElementById('filter-brand').value,
      search: document.getElementById('filter-search').value.trim().toLowerCase(),
    };
  },

  toISO(str) {
    if (!str) return '';
    const m = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (!m) return str;
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  },

  sortVal(row, col) {
    const nums = ['quantity','l','w','h','pzxb','kg','m3','bultos'];
    const map  = {
      tipo:         String(row.d.plTipo || 1),
      empresa:      row.d.empresa || 'PERFECT PTY',
      deliveryCode: row.d.deliveryCode, date: row.dDate,
      client: row.d.client, order: row.d.orderNumber,
      source: row.d.sourceFile, code: row.p.code,
      description: row.p.description, brand: row.p.brand,
      ubicacion: row.p.ubicacion,
    };
    if (col in map) return map[col] || '';
    return nums.includes(col) ? (row.p[col] || 0) : (row.p[col] || '');
  },

  renderDatabase() {
    const wrap = document.getElementById('db-table-wrap');
    const f    = this.getFilters();

    let rows = [];
    this.deliveries.forEach(d => {
      const dDate = this.toISO(d.date);
      d.products.forEach(p => rows.push({ d, p, dDate }));
    });

    if (f.from)   rows = rows.filter(r => r.dDate >= f.from);
    if (f.to)     rows = rows.filter(r => r.dDate <= f.to);
    if (f.tipo)   rows = rows.filter(r => String(r.d.plTipo || 1) === f.tipo);
    if (f.code)   rows = rows.filter(r => r.p.code.toLowerCase().includes(f.code));
    if (f.brand)  rows = rows.filter(r => (r.p.brand||'').toUpperCase() === f.brand);
    if (f.search) rows = rows.filter(r => {
      const hay = [r.d.deliveryCode, r.d.client, r.d.orderNumber, r.d.empresa,
                   r.p.code, r.p.description, r.p.brand, r.p.ubicacion]
                  .join(' ').toLowerCase();
      return hay.includes(f.search);
    });

    if (this.sortCol) {
      const dir = this.sortDir === 'asc' ? 1 : -1;
      rows.sort((a, b) => {
        const va = this.sortVal(a, this.sortCol), vb = this.sortVal(b, this.sortCol);
        return va < vb ? -dir : va > vb ? dir : 0;
      });
    }

    document.getElementById('results-count').textContent =
      `${rows.length} resultado(s) de ${this.deliveries.flatMap(d=>d.products).length} total`;

    if (!rows.length) {
      wrap.innerHTML = `<div class="empty-state"><h3>Sin resultados</h3><p>Ajustá los filtros</p></div>`;
      return;
    }

    const sc = this.sortCol, sd = this.sortDir;
    const th = (col, label) => {
      let cls = 'sortable';
      if (sc === col) cls += sd === 'asc' ? ' sort-asc' : ' sort-desc';
      return `<th class="${cls}" data-col="${col}">${label}</th>`;
    };

    wrap.innerHTML = `<div class="card" style="padding:0;overflow:hidden">
      <div class="table-wrap"><table>
        <thead><tr>
          ${th('tipo','Tipo PL')}${th('empresa','Empresa')}
          ${th('deliveryCode','Código Entrega')}${th('date','Fecha')}${th('client','Cliente')}
          ${th('order','Orden')}${th('code','Cód. Prod.')}${th('description','Descripción')}
          ${th('quantity','Cantidad')}${th('brand','Marca')}
          ${th('l','L (cm)')}${th('w','W (cm)')}${th('h','H (cm)')}
          ${th('kg','kg')}${th('m3','m³')}${th('bultos','Bultos')}
          ${th('nBultos','N° Bultos')}${th('ubicacion','Ubicación')}${th('source','Archivo')}
        </tr></thead>
        <tbody>${rows.map(({ d, p }) => {
          const tipo = d.plTipo || 1;
          const tipoBadge = `<span class="badge badge-tipo${tipo}" style="font-size:11px">T${tipo}</span>`;
          return `<tr>
          <td style="text-align:center">${tipoBadge}</td>
          <td style="font-size:11px;white-space:nowrap">${esc(d.empresa||'PERFECT PTY')}</td>
          <td><strong>${esc(d.deliveryCode)}</strong></td>
          <td>${esc(d.date||'')}</td><td>${esc(d.client||'')}</td><td>${esc(d.orderNumber||'')}</td>
          <td><span style="font-family:monospace;font-weight:700;color:var(--primary)">[${esc(p.code)}]</span></td>
          <td style="max-width:240px;white-space:pre-line;font-size:11px">${esc(p.description||'')}</td>
          <td class="td-num">${fmt(p.quantity,0)}</td>
          <td>${brandBadge(p.brand)}</td>
          <td class="td-num">${fmt(p.l,1)}</td><td class="td-num">${fmt(p.w,1)}</td><td class="td-num">${fmt(p.h,1)}</td>
          <td class="td-num">${fmt(p.kg,2)}</td><td class="td-num">${fmt(p.m3,4)}</td><td class="td-num">${fmt(p.bultos,0)}</td>
          <td>${esc(p.nBultos||'')}</td><td>${esc(p.ubicacion||'')}</td>
          <td style="font-size:11px;color:var(--text-2)">${esc(d.sourceFile||'')}</td>
        </tr>`;}).join('')}</tbody>
      </table></div>
    </div>`;

    wrap.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        this.sortDir = (this.sortCol === col && this.sortDir === 'asc') ? 'desc' : 'asc';
        this.sortCol = col;
        this.renderDatabase();
      });
    });
  },

  async loadTestData() {
    const test = [
      {
        id: 'COLON/OUT/99999', deliveryCode: 'COLON/OUT/99999',
        orderNumber: 'S999001', warehouse: 'PERFECT PTY',
        status: 'Hecho', date: '15/01/2024',
        seller: 'JUAN GARCIA', client: 'ROLO AUTOREPUESTOS',
        sourceFile: '[Datos de prueba]', loadedAt: new Date().toISOString(),
        products: [
          { code:'11001', description:'AMORTIGUADOR\nDELANTERO IZQUIERDO\nHONDA CIVIC 2019-2022',
            quantity:10, brand:'PERFECT', l:45, w:30, h:20, pzxb:2,
            kg:22, m3:0.027, bultos:5, nBultos:'1 al 5', ubicacion:'CLN' },
          { code:'11002', description:'AMORTIGUADOR\nDELANTERO DERECHO\nTOYOTA COROLLA 2018-2023',
            quantity:8, brand:'PERFECT', l:50, w:35, h:25, pzxb:2,
            kg:28, m3:0.044, bultos:4, nBultos:'6 al 9', ubicacion:'CLN' },
          { code:'11003', description:'AMORTIGUADOR\nTRASERO IZQUIERDO\nNISSAN SENTRA 2020-2024',
            quantity:12, brand:'NATSUKI', l:42, w:28, h:22, pzxb:4,
            kg:18, m3:0.026, bultos:3, nBultos:'10 al 12', ubicacion:'STK' },
        ],
      },
    ];
    const map = Object.fromEntries(this.deliveries.map(d => [d.id, d]));
    test.forEach(d => { map[d.id] = d; });
    this.deliveries = Object.values(map);
    try { await DB.putMany(test); } catch (_) {}
    notify(`Datos de prueba cargados: ${test[0].products.length} productos`, 'success');
    this.renderCurrentView();
    this.renderUpload();
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
