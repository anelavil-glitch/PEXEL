'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// INDEXEDDB
// ═══════════════════════════════════════════════════════════════════════════
const DB = (() => {
  const DB_NAME  = 'PackingListDB';
  const DB_VER   = 1;
  const STORE    = 'deliveries';
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
// PDF PARSER  — works with individual positional tokens from PDF.js
// ═══════════════════════════════════════════════════════════════════════════
const Parser = (() => {
  // px threshold to consider two tokens on the same line
  const Y_THRESH = 4;

  // ── Group tokens by Y coordinate (top-to-bottom order) ──────────────────
  function groupByY(items) {
    const valid = items.filter(t => t.str && t.str.trim().length > 0);
    if (!valid.length) return [];

    // Sort Y descending (highest = top of page in PDF coords)
    valid.sort((a, b) => b.transform[5] - a.transform[5]);

    const rows = [];
    let rowY    = valid[0].transform[5];
    let current = [];

    for (const item of valid) {
      const y = item.transform[5];
      if (Math.abs(y - rowY) > Y_THRESH) {
        if (current.length) rows.push(current.sort((a, b) => a.transform[4] - b.transform[4]));
        current = [];
        rowY    = y;
      }
      current.push(item);
    }
    if (current.length) rows.push(current.sort((a, b) => a.transform[4] - b.transform[4]));

    return rows;
  }

  function rowText(row) { return row.map(t => t.str).join(' '); }

  // ── Detect column X-positions from the header row ────────────────────────
  function detectColumns(headerRow) {
    const tokens = headerRow
      .map(t => ({ str: t.str.trim(), x: t.transform[4] }))
      .filter(t => t.str.length > 0);

    const cols = {};

    // Each matcher: [regex to test against token (or 2-token combo), field name]
    const matchers = [
      [/^producto$/i,            'producto'],
      [/^cant(idad)?\.?$/i,      'cantidad'],
      [/^marca$/i,               'marca'],
      [/^l(\(cm\))?$/i,          'l'],
      [/^w(\(cm\))?$/i,          'w'],
      [/^h(\(cm\))?$/i,          'h'],
      [/^p\.?z\.?x\.?b\.?$/i,    'pzxb'],
      [/^kg$/i,                  'kg'],
      [/^m[³3]$/i,               'm3'],
      [/^bultos$/i,              'bultos'],
      [/^n[°o][\s-]?bultos$/i,   'nbultos'],
      [/^n[°o]$/i,               'nbultos'],
      [/^ubicaci[oó]n$/i,        'ubicacion'],
    ];

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];

      // single-token match
      for (const [rx, field] of matchers) {
        if (!(field in cols) && rx.test(t.str)) { cols[field] = t.x; break; }
      }

      // two-token combination (handles "N°" + "Bultos", "L" + "(cm)", etc.)
      if (i + 1 < tokens.length) {
        const combo  = t.str + tokens[i + 1].str;
        const combo2 = t.str + ' ' + tokens[i + 1].str;
        for (const [rx, field] of matchers) {
          if (!(field in cols) && (rx.test(combo) || rx.test(combo2))) {
            cols[field] = t.x; break;
          }
        }
      }

      // handle standalone "(cm)" — assign to previous L/W/H token
      if (/^\(cm\)$/i.test(t.str) && i > 0) {
        const prev = tokens[i - 1].str.toLowerCase();
        if      (prev === 'l' && !cols.l) cols.l = tokens[i - 1].x;
        else if (prev === 'w' && !cols.w) cols.w = tokens[i - 1].x;
        else if (prev === 'h' && !cols.h) cols.h = tokens[i - 1].x;
      }
    }

    console.debug('[Parser] columns detected:', cols);
    return cols;
  }

  // ── Assign a token's X position to the nearest column ───────────────────
  function assignCol(x, cols) {
    const dataStart = cols.cantidad ?? 140;
    if (x < dataStart - 8) return 'producto';

    const sorted = Object.entries(cols)
      .filter(([f]) => f !== 'producto')
      .sort((a, b) => a[1] - b[1]);

    let best = null;
    for (const [field, cx] of sorted) {
      if (x >= cx - 6) best = field;
      else break;
    }
    return best;
  }

  // ── Parse delivery header metadata (rows before column header) ───────────
  function parseHeaderMeta(rows) {
    const text = rows.map(r => rowText(r)).join('\n');

    const grab = (...patterns) => {
      for (const p of patterns) {
        const m = text.match(p);
        if (m) return m[1].trim();
      }
      return '';
    };

    const codeMatch = text.match(/COLON\/OUT\/(\d+)/);
    return {
      deliveryCode: codeMatch ? `COLON/OUT/${codeMatch[1]}` : '',
      orderNumber:  grab(/[Oo]rden\s*[:\-]\s*([A-Z0-9]+)/, /N[°o]\s*[Oo]rden\s*[:\-]\s*([A-Z0-9]+)/),
      warehouse:    grab(/Almac[eé]n\s*[:\-]\s*(.+?)(?=\s{2,}|\n|$)/m),
      status:       grab(/[Ee]stado\s*[:\-]\s*(.+?)(?=\s{2,}|\n|$)/m),
      date:         grab(/[Ff]echa\s*[:\-]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/),
      seller:       grab(/[Vv]endedor\s*[:\-]\s*(.+?)(?=\s{2,}|\n|$)/m),
      client:       grab(/[Cc]liente\s*[:\-]\s*(.+?)(?=\s{2,}|\n|$)/m),
    };
  }

  // ── Is this row a repeat of the column header? (for multi-page PDFs) ─────
  function isColHeader(row) {
    const t = rowText(row).toLowerCase();
    return /producto/.test(t) && (/cantidad/.test(t) || /marca/.test(t));
  }

  // ── Parse product rows ───────────────────────────────────────────────────
  function parseProducts(rows, cols) {
    const dataStart = cols.cantidad ?? 140;
    const products  = [];
    let   cur       = null;
    let   totals    = null;

    for (const row of rows) {
      // Skip repeated column headers (multi-page)
      if (isColHeader(row)) continue;

      const leftToks  = row.filter(t => t.transform[4] < dataStart);
      const rightToks = row.filter(t => t.transform[4] >= dataStart - 6);
      const leftText  = leftToks.map(t => t.str).join(' ').trim();
      const allText   = rowText(row);

      // ── Totals row ──
      if (/^totale?s?[:\s]/i.test(leftText) || /^totale?s?[:\s]/i.test(allText) ||
          (/^total$/i.test(leftText.split(/\s/)[0]))) {
        if (cur) { products.push(cur); cur = null; }
        totals = {};
        for (const t of rightToks) {
          const col = assignCol(t.transform[4], cols);
          const val = parseFloat(t.str.replace(',', '.'));
          if (col && !isNaN(val)) totals[col] = val;
        }
        continue;
      }

      // ── New product row: has [NNNNN] code AND numeric data to the right ──
      const codeMatch = leftText.match(/\[(\d+)\]/);
      const hasData   = rightToks.some(t => t.transform[4] >= dataStart);

      if (codeMatch && hasData) {
        if (cur) products.push(cur);

        cur = {
          code:        codeMatch[1],
          description: leftText.replace(/\[\d+\]/, '').trim(),
          quantity: 0, brand: '', l: 0, w: 0, h: 0,
          pzxb: 0, kg: 0, m3: 0, bultos: 0,
          nBultos: '', ubicacion: '',
        };

        for (const t of rightToks) {
          const col = assignCol(t.transform[4], cols);
          const str = t.str.trim();
          if (!col || !str) continue;
          switch (col) {
            case 'cantidad':  cur.quantity  = parseFloat(str.replace(',', '.')) || 0; break;
            case 'marca':     cur.brand     = str;                                    break;
            case 'l':         cur.l         = parseFloat(str.replace(',', '.')) || 0; break;
            case 'w':         cur.w         = parseFloat(str.replace(',', '.')) || 0; break;
            case 'h':         cur.h         = parseFloat(str.replace(',', '.')) || 0; break;
            case 'pzxb':      cur.pzxb      = parseFloat(str.replace(',', '.')) || 0; break;
            case 'kg':        cur.kg        = parseFloat(str.replace(',', '.')) || 0; break;
            case 'm3':        cur.m3        = parseFloat(str.replace(/[m³,]/g, '').trim()) || 0; break;
            case 'bultos':    cur.bultos    = parseFloat(str.replace(',', '.')) || 0; break;
            case 'nbultos':   cur.nBultos   = str;                                    break;
            case 'ubicacion': cur.ubicacion = str;                                    break;
          }
        }

      } else if (cur && leftText && !hasData) {
        // Description continuation lines
        cur.description = cur.description
          ? cur.description + '\n' + leftText
          : leftText;
      }
    }

    if (cur) products.push(cur);

    // Attach totals as a non-enumerable sidecar
    Object.defineProperty(products, '_totals', { value: totals, enumerable: false, writable: true });
    return products;
  }

  // ── Main entry: parse a PDF ArrayBuffer → array of delivery objects ──────
  async function parsePDF(arrayBuffer, filename) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    console.log(`[Parser] ${filename}: ${pdf.numPages} pages`);

    // Collect all tokens from all pages, offsetting Y so pages stack top-to-bottom
    const allTokens = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page     = await pdf.getPage(p);
      const vp       = page.getViewport({ scale: 1 });
      const yOffset  = (1 - p) * vp.height;   // page1=0, page2=-h, page3=-2h
      const tc       = await page.getTextContent();

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

    const rows = groupByY(allTokens);
    console.log(`[Parser] ${rows.length} rows grouped`);

    // Find section starts: rows containing COLON/OUT/XXXXX
    const secStarts = [];
    rows.forEach((row, i) => {
      if (/COLON\/OUT\/\d+/.test(rowText(row))) secStarts.push(i);
    });

    if (!secStarts.length) {
      // Fallback: treat whole doc as one section (try to find header anywhere)
      console.warn('[Parser] No COLON/OUT pattern found — attempting full-doc parse');
      secStarts.push(0);
    }

    const deliveries = [];

    for (let s = 0; s < secStarts.length; s++) {
      const secRows = rows.slice(secStarts[s], secStarts[s + 1] ?? rows.length);

      // Find the column header row (within first 30 rows of section)
      let colHdrIdx = -1;
      for (let i = 0; i < Math.min(secRows.length, 30); i++) {
        if (isColHeader(secRows[i])) { colHdrIdx = i; break; }
      }

      if (colHdrIdx === -1) {
        console.warn(`[Parser] Section ${s}: column header not found, skipping`);
        continue;
      }

      const cols     = detectColumns(secRows[colHdrIdx]);
      const meta     = parseHeaderMeta(secRows.slice(0, colHdrIdx));
      const products = parseProducts(secRows.slice(colHdrIdx + 1), cols);

      const code = meta.deliveryCode || `DELIVERY-${s}-${Date.now()}`;
      console.log(`[Parser] Section "${code}": ${products.length} products`);

      deliveries.push({
        id:           code,
        deliveryCode: code,
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
// EXCEL EXPORT  (uses xlsx-js-style for cell styling)
// ═══════════════════════════════════════════════════════════════════════════
const Exporter = (() => {
  // Colour helpers (no # prefix)
  const C = {
    BLUE:      '1A56DB',
    BLUE_LIGHT:'DBEAFE',
    BLUE_HDR:  '1E429F',
    GRAY:      'F9FAFB',
    WHITE:     'FFFFFF',
    BLACK:     '111827',
    BORDER:    'E5E7EB',
    YELLOW:    'FEF3C7',
  };

  const s = (font, fill, align) => ({
    font:  { ...{ sz: 10, color: { rgb: C.BLACK } }, ...font },
    fill:  fill  ? { fgColor: { rgb: fill }, patternType: 'solid' } : { patternType: 'none' },
    alignment: { ...{ wrapText: true, vertical: 'center' }, ...align },
    border: {
      top:    { style: 'thin', color: { rgb: C.BORDER } },
      bottom: { style: 'thin', color: { rgb: C.BORDER } },
      left:   { style: 'thin', color: { rgb: C.BORDER } },
      right:  { style: 'thin', color: { rgb: C.BORDER } },
    },
  });

  const cell = (v, t, style) => ({ v, t: t || (typeof v === 'number' ? 'n' : 's'), s: style });
  const nf   = v => cell(v || 0, 'n', s({ sz: 10 }, null, { horizontal: 'right' }));
  const tf   = (v, bg) => cell(v || '', 's', s({ sz: 10 }, bg));

  function addSheet(wb, sheetName, data, colWidths, merges) {
    const ws = {};
    let maxR = 0, maxC = 0;

    data.forEach((row, r) => {
      row.forEach((cellVal, c) => {
        const addr = XLSX.utils.encode_cell({ r, c });
        ws[addr] = typeof cellVal === 'object' && cellVal !== null && 'v' in cellVal
          ? cellVal
          : cell(cellVal == null ? '' : String(cellVal), 's', s());
        maxC = Math.max(maxC, c + 1);
      });
      maxR = r + 1;
    });

    ws['!ref']   = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR - 1, c: maxC - 1 } });
    ws['!cols']  = (colWidths || []).map(w => ({ wch: w }));
    if (merges) ws['!merges'] = merges;

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return ws;
  }

  // ── Sheet 1: Vista PDF ───────────────────────────────────────────────────
  function buildVistaSheet(wb, deliveries) {
    const COLS = ['Código','Descripción','Cantidad','Marca','L(cm)','W(cm)','H(cm)','PZxB','kg','m³','Bultos','N° Bultos','Ubicación'];
    const colW = [12, 40, 9, 10, 7, 7, 7, 7, 8, 8, 8, 12, 10];

    const data   = [];
    const merges = [];

    const hdrStyle  = s({ bold: true, sz: 11, color: { rgb: C.WHITE } }, C.BLUE,     { horizontal: 'center' });
    const metaKey   = s({ bold: true, sz: 10, color: { rgb: C.BLUE_HDR } }, C.BLUE_LIGHT);
    const metaVal   = s({ sz: 10 }, C.BLUE_LIGHT);
    const colHdrSt  = s({ bold: true, sz: 10, color: { rgb: C.WHITE } }, C.BLUE_HDR, { horizontal: 'center' });
    const totStyle  = s({ bold: true, sz: 10 }, C.GRAY, { horizontal: 'right' });

    const NUM_COLS = COLS.length;

    deliveries.forEach(d => {
      const startRow = data.length;

      // Row 0: delivery code header (merged)
      const hdrRow = Array(NUM_COLS).fill(cell('', 's', hdrStyle));
      hdrRow[0] = cell(d.deliveryCode, 's', hdrStyle);
      data.push(hdrRow);
      merges.push({ s: { r: startRow, c: 0 }, e: { r: startRow, c: NUM_COLS - 1 } });

      // Rows 1-3: metadata pairs
      const metaFields = [
        [['Orden', d.orderNumber], ['Almacén', d.warehouse], ['Estado', d.status]],
        [['Fecha', d.date],        ['Vendedor', d.seller]],
        [['Cliente', d.client],    ['Archivo', d.sourceFile]],
      ];

      metaFields.forEach(pairs => {
        const row = Array(NUM_COLS).fill(cell('', 's', metaVal));
        let c = 0;
        pairs.forEach(([k, v]) => {
          row[c]     = cell(k + ':', 's', metaKey);
          row[c + 1] = cell(v || '', 's', metaVal);
          c += 4;
        });
        data.push(row);
      });

      // Column header row
      data.push(COLS.map(h => cell(h, 's', colHdrSt)));

      // Product rows
      const prodStart = data.length;
      d.products.forEach((p, pi) => {
        const rowBg = pi % 2 === 0 ? null : C.GRAY;
        const rowStyle = s({ sz: 10 }, rowBg);
        const numStyle = s({ sz: 10 }, rowBg, { horizontal: 'right' });

        data.push([
          cell(`[${p.code}]`,       's', s({ bold: true, sz: 10, color: { rgb: C.BLUE } }, rowBg)),
          cell(p.description || '', 's', s({ sz: 9 }, rowBg)),
          cell(p.quantity,          'n', numStyle),
          cell(p.brand,             's', rowBg === C.GRAY ? s({ sz: 10 }, C.GRAY) : s({ sz: 10 })),
          cell(p.l,  'n', numStyle),
          cell(p.w,  'n', numStyle),
          cell(p.h,  'n', numStyle),
          cell(p.pzxb, 'n', numStyle),
          cell(p.kg,   'n', numStyle),
          cell(p.m3,   'n', numStyle),
          cell(p.bultos, 'n', numStyle),
          cell(p.nBultos || '', 's', rowStyle),
          cell(p.ubicacion || '', 's', rowStyle),
        ]);
      });

      // Totals row
      const tot = d.totals || calcTotals(d.products);
      const totRow = Array(NUM_COLS).fill(cell('', 's', totStyle));
      totRow[0] = cell('TOTAL', 's', s({ bold: true, sz: 10 }, C.GRAY));
      totRow[2] = cell(tot.cantidad  || tot.quantity || 0, 'n', totStyle);
      totRow[8] = cell(tot.kg  || 0, 'n', totStyle);
      totRow[9] = cell(tot.m3  || 0, 'n', totStyle);
      totRow[10]= cell(tot.bultos || 0, 'n', totStyle);
      data.push(totRow);

      // Blank separator
      data.push(Array(NUM_COLS).fill(cell('', 's', s())));
    });

    addSheet(wb, 'Vista PDF', data, colW, merges);
  }

  // ── Sheet 2: Resumen ─────────────────────────────────────────────────────
  function buildResumenSheet(wb, deliveries) {
    const hdrSt  = s({ bold: true, sz: 10, color: { rgb: C.WHITE } }, C.BLUE, { horizontal: 'center' });
    const grpSt  = s({ bold: true, sz: 10 }, C.BLUE_LIGHT);
    const numSt  = s({ sz: 10 }, null, { horizontal: 'right' });
    const totSt  = s({ bold: true, sz: 10 }, C.GRAY, { horizontal: 'right' });

    const data = [];

    // Table 1: Per delivery
    data.push(['Entregas por código de entrega'].map(v => cell(v, 's', hdrSt)));
    data[0] = ['Código Entrega','Orden','Fecha','Cliente','Almacén','Estado','Productos','Cant. Total','kg Total','m³ Total','Bultos Total']
      .map(h => cell(h, 's', hdrSt));

    let totQty = 0, totKg = 0, totM3 = 0, totBultos = 0;

    deliveries.forEach((d, i) => {
      const tot = calcTotals(d.products);
      totQty    += tot.quantity;
      totKg     += tot.kg;
      totM3     += tot.m3;
      totBultos += tot.bultos;
      const bg  = i % 2 === 0 ? null : C.GRAY;
      const st  = s({ sz: 10 }, bg);
      const ns  = s({ sz: 10 }, bg, { horizontal: 'right' });
      data.push([
        cell(d.deliveryCode,    's', st),
        cell(d.orderNumber,     's', st),
        cell(d.date,            's', st),
        cell(d.client,          's', st),
        cell(d.warehouse,       's', st),
        cell(d.status,          's', st),
        cell(d.products.length, 'n', ns),
        cell(tot.quantity, 'n', ns),
        cell(tot.kg,       'n', ns),
        cell(tot.m3,       'n', ns),
        cell(tot.bultos,   'n', ns),
      ]);
    });

    // Grand total row
    data.push([
      cell('TOTAL GENERAL', 's', totSt),
      cell('', 's', totSt), cell('', 's', totSt),
      cell('', 's', totSt), cell('', 's', totSt),
      cell('', 's', totSt),
      cell(deliveries.reduce((a, d) => a + d.products.length, 0), 'n', totSt),
      cell(totQty,    'n', totSt),
      cell(totKg,     'n', totSt),
      cell(totM3,     'n', totSt),
      cell(totBultos, 'n', totSt),
    ]);

    data.push(Array(11).fill(cell('', 's', s())));

    // Table 2: Per brand
    data.push(['Marca','Productos','Cant. Total','kg Total','m³ Total'].map(h => cell(h, 's', hdrSt)));
    const byBrand = {};
    deliveries.forEach(d => d.products.forEach(p => {
      const brand = p.brand || 'Sin marca';
      if (!byBrand[brand]) byBrand[brand] = { products: 0, quantity: 0, kg: 0, m3: 0 };
      byBrand[brand].products++;
      byBrand[brand].quantity += p.quantity;
      byBrand[brand].kg       += p.kg;
      byBrand[brand].m3       += p.m3;
    }));

    Object.entries(byBrand).forEach(([brand, v], i) => {
      const bg = i % 2 === 0 ? null : C.GRAY;
      data.push([
        cell(brand,      's', s({ sz: 10 }, bg)),
        cell(v.products, 'n', s({ sz: 10 }, bg, { horizontal: 'right' })),
        cell(v.quantity, 'n', s({ sz: 10 }, bg, { horizontal: 'right' })),
        cell(v.kg,       'n', s({ sz: 10 }, bg, { horizontal: 'right' })),
        cell(v.m3,       'n', s({ sz: 10 }, bg, { horizontal: 'right' })),
      ]);
    });

    addSheet(wb, 'Resumen', data, [22, 12, 10, 12, 12, 10, 10, 12, 10, 10, 12]);
  }

  // ── Sheet 3: Base de datos ────────────────────────────────────────────────
  function buildDBSheet(wb, deliveries) {
    const hdrSt = s({ bold: true, sz: 10, color: { rgb: C.WHITE } }, C.BLUE, { horizontal: 'center' });

    const COLS = [
      'Archivo','Código Entrega','Orden','Almacén','Estado','Fecha','Vendedor','Cliente',
      'Cód. Producto','Descripción','Cantidad','Marca','L(cm)','W(cm)','H(cm)',
      'PZxB','kg','m³','Bultos','N° Bultos','Ubicación'
    ];

    const data = [COLS.map(h => cell(h, 's', hdrSt))];

    deliveries.forEach((d, di) => {
      d.products.forEach((p, pi) => {
        const bg = di % 2 === 0 ? null : C.GRAY;
        const st = s({ sz: 10 }, bg);
        const ns = s({ sz: 10 }, bg, { horizontal: 'right' });
        data.push([
          cell(d.sourceFile,   's', st),
          cell(d.deliveryCode, 's', st),
          cell(d.orderNumber,  's', st),
          cell(d.warehouse,    's', st),
          cell(d.status,       's', st),
          cell(d.date,         's', st),
          cell(d.seller,       's', st),
          cell(d.client,       's', st),
          cell(p.code,         's', s({ bold: true, sz: 10, color: { rgb: C.BLUE } }, bg)),
          cell(p.description,  's', st),
          cell(p.quantity, 'n', ns),
          cell(p.brand,    's', st),
          cell(p.l,     'n', ns), cell(p.w,  'n', ns), cell(p.h,   'n', ns),
          cell(p.pzxb,  'n', ns), cell(p.kg, 'n', ns), cell(p.m3,  'n', ns),
          cell(p.bultos,'n', ns), cell(p.nBultos   || '', 's', st),
          cell(p.ubicacion || '', 's', st),
        ]);
      });
    });

    addSheet(wb, 'Base de datos', data,
      [20, 18, 10, 14, 10, 11, 16, 22, 12, 40, 9, 10, 7, 7, 7, 7, 8, 8, 8, 12, 10]);
  }

  function exportToExcel(deliveries) {
    if (!deliveries.length) { notify('No hay datos para exportar', 'error'); return; }

    const wb = XLSX.utils.book_new();
    wb.Props = { Title: 'Packing List Manager', Author: 'PERFECT PTY' };

    buildVistaSheet(wb, deliveries);
    buildResumenSheet(wb, deliveries);
    buildDBSheet(wb, deliveries);

    const now  = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    XLSX.writeFile(wb, `PackingList_${date}.xlsx`);
    notify('Excel exportado correctamente', 'success');
  }

  return { exportToExcel };
})();


// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════
function calcTotals(products) {
  return products.reduce((acc, p) => ({
    quantity: acc.quantity + (p.quantity || 0),
    kg:       acc.kg       + (p.kg       || 0),
    m3:       acc.m3       + (p.m3       || 0),
    bultos:   acc.bultos   + (p.bultos   || 0),
  }), { quantity: 0, kg: 0, m3: 0, bultos: 0 });
}

function fmt(n, dec = 3) {
  if (n == null || n === '') return '';
  const num = parseFloat(n);
  return isNaN(num) ? '' : num.toLocaleString('es-PA', { minimumFractionDigits: 0, maximumFractionDigits: dec });
}

function escape(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function brandBadge(brand) {
  const b = (brand || '').toUpperCase();
  if (b.includes('PERFECT')) return `<span class="badge badge-perfect">${escape(brand)}</span>`;
  if (b.includes('NATSUKI')) return `<span class="badge badge-natsuki">${escape(brand)}</span>`;
  return `<span class="badge">${escape(brand)}</span>`;
}

function ubicBadge(ubic) {
  const u = (ubic || '').toUpperCase();
  if (u.includes('CLN')) return `<span class="badge badge-cln">${escape(ubic)}</span>`;
  if (u.includes('STK')) return `<span class="badge badge-stk">${escape(ubic)}</span>`;
  return escape(ubic);
}

let _notifTimer = null;
function notify(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `notif notif-${type}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  el.innerHTML = `<span>${icon}</span><span>${escape(msg)}</span>`;
  document.getElementById('notifications').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}


// ═══════════════════════════════════════════════════════════════════════════
// APP STATE & RENDER
// ═══════════════════════════════════════════════════════════════════════════
const App = {
  deliveries:    [],
  filtered:      [],
  currentView:   'upload',
  sortCol:       null,
  sortDir:       'asc',

  // ── Init ────────────────────────────────────────────────────────────────
  async init() {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // Load persisted data
    try {
      const saved = await DB.getAll();
      if (saved.length) {
        this.deliveries = saved;
        notify(`${saved.length} entrega(s) cargada(s) desde la base de datos local`, 'info');
      }
    } catch (e) {
      console.warn('IndexedDB unavailable:', e.message);
    }

    this.renderCurrentView();
    this.bindNav();
    this.bindUpload();
    this.bindFilters();
    document.getElementById('btn-export-excel').addEventListener('click',
      () => Exporter.exportToExcel(this.deliveries));
    document.getElementById('btn-clear-db').addEventListener('click',
      () => this.clearDB());
  },

  // ── Navigation ───────────────────────────────────────────────────────────
  bindNav() {
    document.querySelectorAll('.nav-tabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setView(btn.dataset.view);
      });
    });
  },

  setView(view) {
    this.currentView = view;
    document.querySelectorAll('.nav-tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach(v => {
      v.classList.toggle('active', v.id === `view-${view}`);
    });
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

  // ── Upload view ──────────────────────────────────────────────────────────
  bindUpload() {
    const dz   = document.getElementById('dropzone');
    const inp  = document.getElementById('file-input');

    dz.addEventListener('click', () => inp.click());
    document.getElementById('btn-select-file').addEventListener('click', () => inp.click());
    document.getElementById('btn-test-data').addEventListener('click', () => this.loadTestData());

    inp.addEventListener('change', e => {
      if (e.target.files.length) this.processFiles(Array.from(e.target.files));
      inp.value = '';
    });

    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.pdf'));
      if (files.length) this.processFiles(files);
    });
  },

  async processFiles(files) {
    const prog = document.getElementById('progress-area');
    prog.innerHTML = `
      <div class="progress-wrap">
        <div class="progress-label" id="prog-label">Procesando 0 / ${files.length}…</div>
        <div class="progress-bar"><div class="progress-bar-fill" id="prog-fill" style="width:0"></div></div>
      </div>`;

    const newDeliveries = [];
    for (let i = 0; i < files.length; i++) {
      document.getElementById('prog-label').textContent = `Procesando ${i + 1} / ${files.length}: ${files[i].name}`;
      document.getElementById('prog-fill').style.width = `${Math.round(i / files.length * 100)}%`;
      try {
        const buf  = await files[i].arrayBuffer();
        const devs = await Parser.parsePDF(buf, files[i].name);
        newDeliveries.push(...devs);
        notify(`${files[i].name}: ${devs.length} entrega(s) encontrada(s)`, devs.length ? 'success' : 'error');
      } catch (e) {
        console.error(e);
        notify(`Error procesando ${files[i].name}: ${e.message}`, 'error');
      }
    }

    document.getElementById('prog-fill').style.width = '100%';
    setTimeout(() => { prog.innerHTML = ''; }, 1200);

    if (newDeliveries.length) {
      // Merge: overwrite existing by id
      const map = Object.fromEntries(this.deliveries.map(d => [d.id, d]));
      newDeliveries.forEach(d => { map[d.id] = d; });
      this.deliveries = Object.values(map);

      try { await DB.putMany(newDeliveries); } catch (e) { /* offline ok */ }
      notify(`${newDeliveries.length} entrega(s) guardada(s) en BD local`, 'success');
      this.renderCurrentView();
    }
    this.renderUpload();
  },

  renderUpload() {
    const wrap = document.getElementById('recent-list-wrap');
    const cnt  = document.getElementById('delivery-count');
    cnt.textContent = `${this.deliveries.length} entrega(s)`;

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
      this.deliveries.map(d => `
        <div class="recent-item">
          <div class="ri-icon">📦</div>
          <div class="ri-info">
            <div class="ri-name">${escape(d.deliveryCode)}</div>
            <div class="ri-meta">
              ${escape(d.client || '')} · ${escape(d.date || '')} · ${d.products.length} productos
              · <em>${escape(d.sourceFile || '')}</em>
            </div>
          </div>
          <button class="ri-del" data-id="${escape(d.id)}" title="Eliminar">✕</button>
        </div>`)
      .join('')
    }</div>`;

    wrap.querySelectorAll('.ri-del').forEach(btn => {
      btn.addEventListener('click', () => this.deleteDelivery(btn.dataset.id));
    });
  },

  async deleteDelivery(id) {
    this.deliveries = this.deliveries.filter(d => d.id !== id);
    try { await DB.remove(id); } catch (e) {}
    notify('Entrega eliminada', 'info');
    this.renderCurrentView();
    if (this.currentView !== 'upload') this.renderUpload();
  },

  async clearDB() {
    if (!confirm('¿Eliminar todas las entregas de la base de datos local?')) return;
    this.deliveries = [];
    try { await DB.clear(); } catch (e) {}
    notify('Base de datos vaciada', 'info');
    this.renderCurrentView();
    this.renderUpload();
  },

  // ── PDF View ─────────────────────────────────────────────────────────────
  renderPDFView() {
    const root = document.getElementById('pdf-view-content');

    if (!this.deliveries.length) {
      root.innerHTML = `<div class="empty-state">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="64" height="64">
          <path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12"/>
        </svg>
        <h3>No hay entregas para mostrar</h3><p>Cargá un PDF primero</p>
      </div>`;
      return;
    }

    root.innerHTML = this.deliveries.map(d => {
      const tot = calcTotals(d.products);
      return `
      <div class="delivery-card">
        <div class="delivery-header">
          <div>
            <div class="delivery-code">${escape(d.deliveryCode)}</div>
            <div style="font-size:12px;opacity:.85">${escape(d.sourceFile || '')}</div>
          </div>
          <div style="font-size:12px;text-align:right;opacity:.85">
            Cargado: ${new Date(d.loadedAt).toLocaleDateString('es-PA')}
          </div>
        </div>
        <div class="delivery-meta">
          <div><span>Orden: </span><strong>${escape(d.orderNumber || '—')}</strong></div>
          <div><span>Almacén: </span><strong>${escape(d.warehouse || '—')}</strong></div>
          <div><span>Estado: </span><strong>${escape(d.status || '—')}</strong></div>
          <div><span>Fecha: </span><strong>${escape(d.date || '—')}</strong></div>
          <div><span>Vendedor: </span><strong>${escape(d.seller || '—')}</strong></div>
          <div><span>Cliente: </span><strong>${escape(d.client || '—')}</strong></div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="td-product">Producto</th>
                <th class="td-num">Cant.</th>
                <th>Marca</th>
                <th class="td-num">L(cm)</th>
                <th class="td-num">W(cm)</th>
                <th class="td-num">H(cm)</th>
                <th class="td-num">PZxB</th>
                <th class="td-num">kg</th>
                <th class="td-num">m³</th>
                <th class="td-num">Bultos</th>
                <th>N° Bultos</th>
                <th>Ubicación</th>
              </tr>
            </thead>
            <tbody>
              ${d.products.map(p => `
                <tr>
                  <td class="td-product">
                    <div class="product-code">[${escape(p.code)}]</div>
                    <div class="product-desc">${escape(p.description || '')}</div>
                  </td>
                  <td class="td-num">${fmt(p.quantity, 0)}</td>
                  <td>${brandBadge(p.brand)}</td>
                  <td class="td-num">${fmt(p.l, 1)}</td>
                  <td class="td-num">${fmt(p.w, 1)}</td>
                  <td class="td-num">${fmt(p.h, 1)}</td>
                  <td class="td-num">${fmt(p.pzxb, 0)}</td>
                  <td class="td-num">${fmt(p.kg, 2)}</td>
                  <td class="td-num">${fmt(p.m3, 4)}</td>
                  <td class="td-num">${fmt(p.bultos, 0)}</td>
                  <td>${escape(p.nBultos || '')}</td>
                  <td>${ubicBadge(p.ubicacion)}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="1" style="font-weight:700">TOTALES</td>
                <td class="td-num">${fmt(tot.quantity, 0)}</td>
                <td colspan="5"></td>
                <td class="td-num">${fmt(tot.kg, 2)}</td>
                <td class="td-num">${fmt(tot.m3, 4)}</td>
                <td class="td-num">${fmt(tot.bultos, 0)}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>`;
    }).join('');
  },

  // ── Summary view ─────────────────────────────────────────────────────────
  renderSummary() {
    const root = document.getElementById('summary-content');

    if (!this.deliveries.length) {
      root.innerHTML = `<div class="empty-state">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="64" height="64">
          <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/>
        </svg>
        <h3>Sin datos para resumir</h3><p>Cargá al menos un PDF</p>
      </div>`;
      return;
    }

    const allProducts = this.deliveries.flatMap(d => d.products);
    const grand       = calcTotals(allProducts);

    // By brand
    const byBrand = {};
    allProducts.forEach(p => {
      const b = p.brand || 'Sin marca';
      if (!byBrand[b]) byBrand[b] = { qty: 0, kg: 0, m3: 0, bultos: 0, count: 0 };
      byBrand[b].count++;
      byBrand[b].qty    += p.quantity;
      byBrand[b].kg     += p.kg;
      byBrand[b].m3     += p.m3;
      byBrand[b].bultos += p.bultos;
    });

    root.innerHTML = `
    <!-- Stats cards -->
    <div class="stats-bar">
      <div class="stat-card"><div class="stat-value">${this.deliveries.length}</div><div class="stat-label">Entregas</div></div>
      <div class="stat-card"><div class="stat-value">${allProducts.length}</div><div class="stat-label">Productos</div></div>
      <div class="stat-card"><div class="stat-value">${fmt(grand.quantity,0)}</div><div class="stat-label">Unidades totales</div></div>
      <div class="stat-card"><div class="stat-value">${fmt(grand.kg,0)}</div><div class="stat-label">kg totales</div></div>
      <div class="stat-card"><div class="stat-value">${fmt(grand.m3,3)}</div><div class="stat-label">m³ totales</div></div>
      <div class="stat-card"><div class="stat-value">${fmt(grand.bultos,0)}</div><div class="stat-label">Bultos totales</div></div>
    </div>

    <div class="summary-grid">
      <!-- Deliveries table -->
      <div class="card">
        <div class="card-title">Por entrega</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Código Entrega</th><th>Fecha</th><th>Prods.</th>
                <th class="td-num">Cant.</th><th class="td-num">kg</th>
                <th class="td-num">m³</th><th class="td-num">Bultos</th>
              </tr>
            </thead>
            <tbody>
              ${this.deliveries.map(d => {
                const t = calcTotals(d.products);
                return `<tr>
                  <td><strong>${escape(d.deliveryCode)}</strong></td>
                  <td>${escape(d.date || '—')}</td>
                  <td class="td-num">${d.products.length}</td>
                  <td class="td-num">${fmt(t.quantity,0)}</td>
                  <td class="td-num">${fmt(t.kg,2)}</td>
                  <td class="td-num">${fmt(t.m3,4)}</td>
                  <td class="td-num">${fmt(t.bultos,0)}</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2"><strong>TOTAL</strong></td>
                <td class="td-num"><strong>${allProducts.length}</strong></td>
                <td class="td-num"><strong>${fmt(grand.quantity,0)}</strong></td>
                <td class="td-num"><strong>${fmt(grand.kg,2)}</strong></td>
                <td class="td-num"><strong>${fmt(grand.m3,4)}</strong></td>
                <td class="td-num"><strong>${fmt(grand.bultos,0)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Brand table -->
      <div class="card">
        <div class="card-title">Por marca</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Marca</th><th class="td-num">Items</th>
                <th class="td-num">Cant.</th><th class="td-num">kg</th>
                <th class="td-num">m³</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(byBrand).map(([brand, v]) => `
                <tr>
                  <td>${brandBadge(brand)}</td>
                  <td class="td-num">${v.count}</td>
                  <td class="td-num">${fmt(v.qty,0)}</td>
                  <td class="td-num">${fmt(v.kg,2)}</td>
                  <td class="td-num">${fmt(v.m3,4)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  },

  // ── Database view ────────────────────────────────────────────────────────
  bindFilters() {
    ['filter-date-from','filter-date-to','filter-code','filter-brand','filter-search']
      .forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('input', () => this.renderDatabase());
        el.addEventListener('change', () => this.renderDatabase());
      });

    document.getElementById('btn-clear-filters').addEventListener('click', () => {
      ['filter-date-from','filter-date-to','filter-code','filter-search'].forEach(id => {
        document.getElementById(id).value = '';
      });
      document.getElementById('filter-brand').value = '';
      this.renderDatabase();
    });
  },

  getFilters() {
    return {
      from:   document.getElementById('filter-date-from').value,
      to:     document.getElementById('filter-date-to').value,
      code:   document.getElementById('filter-code').value.trim().toLowerCase(),
      brand:  document.getElementById('filter-brand').value,
      search: document.getElementById('filter-search').value.trim().toLowerCase(),
    };
  },

  // Convert "DD/MM/YYYY" to "YYYY-MM-DD" for comparison
  parseDate(str) {
    if (!str) return '';
    const m = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (!m) return str;
    const yr = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${yr}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  },

  renderDatabase() {
    const wrap = document.getElementById('db-table-wrap');
    const f    = this.getFilters();

    // Flatten all products to rows
    let rows = [];
    this.deliveries.forEach(d => {
      const dDate = this.parseDate(d.date);
      d.products.forEach(p => {
        rows.push({ d, p, dDate });
      });
    });

    // Apply filters
    if (f.from) rows = rows.filter(r => r.dDate >= f.from);
    if (f.to)   rows = rows.filter(r => r.dDate <= f.to);
    if (f.code) rows = rows.filter(r => r.p.code.toLowerCase().includes(f.code));
    if (f.brand) rows = rows.filter(r => (r.p.brand || '').toUpperCase() === f.brand);
    if (f.search) {
      rows = rows.filter(r => {
        const hay = [r.d.deliveryCode, r.d.client, r.d.orderNumber,
                     r.p.code, r.p.description, r.p.brand, r.p.ubicacion]
                    .join(' ').toLowerCase();
        return hay.includes(f.search);
      });
    }

    // Apply sort
    if (this.sortCol) {
      const dir = this.sortDir === 'asc' ? 1 : -1;
      rows.sort((a, b) => {
        const va = this.sortVal(a, this.sortCol);
        const vb = this.sortVal(b, this.sortCol);
        if (va < vb) return -dir;
        if (va > vb) return  dir;
        return 0;
      });
    }

    document.getElementById('results-count').textContent =
      `${rows.length} resultado(s)`;

    if (!rows.length) {
      wrap.innerHTML = `<div class="empty-state">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="48" height="48">
          <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/>
        </svg>
        <h3>Sin resultados</h3><p>Probá ajustando los filtros</p>
      </div>`;
      return;
    }

    const HEADERS = [
      ['deliveryCode','Código Entrega'],['date','Fecha'],['client','Cliente'],
      ['orderNumber','Orden'],['code','Cód. Prod.'],['description','Descripción'],
      ['quantity','Cant.'],['brand','Marca'],['l','L'],['w','W'],['h','H'],
      ['kg','kg'],['m3','m³'],['bultos','Bultos'],['ubicacion','Ubicación'],
      ['sourceFile','Archivo'],
    ];

    const thHTML = HEADERS.map(([col, label]) => {
      let cls = 'sortable';
      if (this.sortCol === col) cls += this.sortDir === 'asc' ? ' sort-asc' : ' sort-desc';
      return `<th class="${cls}" data-col="${col}">${label}</th>`;
    }).join('');

    const tbHTML = rows.map(({ d, p }) => `
      <tr>
        <td><strong>${escape(d.deliveryCode)}</strong></td>
        <td>${escape(d.date || '')}</td>
        <td>${escape(d.client || '')}</td>
        <td>${escape(d.orderNumber || '')}</td>
        <td><span style="font-family:monospace;font-weight:700;color:var(--primary)">[${escape(p.code)}]</span></td>
        <td style="max-width:260px;white-space:pre-line;font-size:11px">${escape(p.description || '')}</td>
        <td class="td-num">${fmt(p.quantity,0)}</td>
        <td>${brandBadge(p.brand)}</td>
        <td class="td-num">${fmt(p.l,1)}</td>
        <td class="td-num">${fmt(p.w,1)}</td>
        <td class="td-num">${fmt(p.h,1)}</td>
        <td class="td-num">${fmt(p.kg,2)}</td>
        <td class="td-num">${fmt(p.m3,4)}</td>
        <td class="td-num">${fmt(p.bultos,0)}</td>
        <td>${ubicBadge(p.ubicacion)}</td>
        <td style="font-size:11px;color:var(--text-2)">${escape(d.sourceFile || '')}</td>
      </tr>`).join('');

    wrap.innerHTML = `
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap">
          <table>
            <thead><tr>${thHTML}</tr></thead>
            <tbody>${tbHTML}</tbody>
          </table>
        </div>
      </div>`;

    wrap.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (this.sortCol === col) {
          this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortCol = col;
          this.sortDir = 'asc';
        }
        this.renderDatabase();
      });
    });
  },

  sortVal(row, col) {
    const nums = ['quantity','l','w','h','pzxb','kg','m3','bultos'];
    switch (col) {
      case 'deliveryCode': return row.d.deliveryCode || '';
      case 'date':         return row.dDate || '';
      case 'client':       return row.d.client || '';
      case 'orderNumber':  return row.d.orderNumber || '';
      case 'sourceFile':   return row.d.sourceFile || '';
      case 'code':         return row.p.code || '';
      case 'description':  return row.p.description || '';
      case 'brand':        return row.p.brand || '';
      case 'ubicacion':    return row.p.ubicacion || '';
      default:
        return nums.includes(col) ? (row.p[col] || 0) : (row.p[col] || '');
    }
  },

  // ── Test data ────────────────────────────────────────────────────────────
  async loadTestData() {
    const testDeliveries = [
      {
        id:           'COLON/OUT/99999',
        deliveryCode: 'COLON/OUT/99999',
        orderNumber:  'S999001',
        warehouse:    'PERFECT PTY',
        status:       'Hecho',
        date:         '15/01/2024',
        seller:       'JUAN GARCIA',
        client:       'ROLO AUTOREPUESTOS',
        sourceFile:   'test-data (datos de prueba)',
        loadedAt:     new Date().toISOString(),
        totals:       { cantidad: 30, kg: 816, m3: 0.243, bultos: 12 },
        products: [
          {
            code: '11001', brand: 'PERFECT',
            description: 'AMORTIGUADOR\nDELANTERO IZQUIERDO\nHONDA CIVIC 2019-2022',
            quantity: 10, l: 45, w: 30, h: 20, pzxb: 2,
            kg: 22, m3: 0.027, bultos: 5, nBultos: '1 al 5', ubicacion: 'CLN',
          },
          {
            code: '11002', brand: 'PERFECT',
            description: 'AMORTIGUADOR\nDELANTERO DERECHO\nTOYOTA COROLLA 2018-2023',
            quantity: 8, l: 50, w: 35, h: 25, pzxb: 2,
            kg: 28, m3: 0.044, bultos: 4, nBultos: '6 al 9', ubicacion: 'CLN',
          },
          {
            code: '11003', brand: 'NATSUKI',
            description: 'AMORTIGUADOR\nTRASERO IZQUIERDO\nNISSAN SENTRA 2020-2024',
            quantity: 12, l: 42, w: 28, h: 22, pzxb: 4,
            kg: 18, m3: 0.026, bultos: 3, nBultos: '10 al 12', ubicacion: 'STK',
          },
        ],
      },
      {
        id:           'COLON/OUT/99998',
        deliveryCode: 'COLON/OUT/99998',
        orderNumber:  'S999002',
        warehouse:    'PERFECT PTY',
        status:       'Hecho',
        date:         '20/01/2024',
        seller:       'MARIA LOPEZ',
        client:       'ROLO AUTOREPUESTOS',
        sourceFile:   'test-data (datos de prueba)',
        loadedAt:     new Date().toISOString(),
        totals:       { cantidad: 25, kg: 520, m3: 0.18, bultos: 8 },
        products: [
          {
            code: '22001', brand: 'PERFECT',
            description: 'AMORTIGUADOR\nDELANTERO\nHYUNDAI TUCSON 2017-2021',
            quantity: 15, l: 55, w: 40, h: 30, pzxb: 1,
            kg: 35, m3: 0.066, bultos: 5, nBultos: '1 al 5', ubicacion: 'CLN',
          },
          {
            code: '22002', brand: 'NATSUKI',
            description: 'AMORTIGUADOR\nTRASERO\nKIA SPORTAGE 2016-2022',
            quantity: 10, l: 38, w: 25, h: 18, pzxb: 4,
            kg: 17, m3: 0.017, bultos: 3, nBultos: '6 al 8', ubicacion: 'STK',
          },
        ],
      },
    ];

    const map = Object.fromEntries(this.deliveries.map(d => [d.id, d]));
    testDeliveries.forEach(d => { map[d.id] = d; });
    this.deliveries = Object.values(map);

    try { await DB.putMany(testDeliveries); } catch (e) {}
    notify(`Datos de prueba cargados: ${testDeliveries.length} entregas, ${testDeliveries.flatMap(d=>d.products).length} productos`, 'success');
    this.renderCurrentView();
    this.renderUpload();
  },
};


// ═══════════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => App.init());
