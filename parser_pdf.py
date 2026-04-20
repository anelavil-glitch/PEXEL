#!/usr/bin/env python3
"""
parser.py — Definitive PDF parser for PERFECT PTY / PARQUE DEL MAR packing lists.
Outputs a JSON file with all parsed data for use by the Node/web layer.
Usage: python3 parser.py input.pdf output.json
"""
import sys, re, json
from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextBox

def norm(s): return s.replace(',', '.').strip()

def fnum(s):
    try: return float(re.sub(r'[^\d.]', '', norm(s)))
    except: return None

def get_boxes(fpath):
    pages = []
    for pl in extract_pages(fpath):
        raw = []
        for el in pl:
            if isinstance(el, LTTextBox):
                t = el.get_text().strip()
                if t:
                    raw.append({
                        'x': round(el.x0),
                        'y': round(el.y0),
                        'y1': round(el.y1),
                        'text': t
                    })
        raw.sort(key=lambda b: -b['y1'])
        pages.append(raw)
    return pages

def detect_format(pages):
    for pg in pages:
        for b in pg:
            if 'WH/OUT/' in b['text']: return 'WH'
            if 'COLON/OUT/' in b['text']: return 'COLON'
    return 'COLON'

SKIP = re.compile(
    r'^(PARQUE|Calle 2|Col[oó]n \(|Panam[aá]$|RUC:|info\.|P[aá]gina:|'
    r'Direcci[oó]n de (E|e)|Bolivia$|Vendedor:|Orden:|Estado:|Cita agendada|Hecho$|'
    r'WH\/OUT\/|COLON\/OUT\/|PERFECT PTY|Panam[aá] Col|Entrega$|Almac[eé]n:|'
    r'Fecha de|SAVI AUTO|ROLO AUTO|GLOBAL RE|AVE\. |CASA DE|TARIJA$|COCHABAMBA|'
    r'SUCRE$|Producto$|Cantidad|Marca$|L \(cm\)|W \(cm\)|H \(cm\)|PZxB$|kg$|m[³3]$|'
    r'Bultos$|N° Bultos|Ubicaci[oó]n|Desde$|C[oó]digo de barras|\(cm\)$|Unidades$|'
    r'Total Bultos|[+\uf095]|Avenida|AVE\. CIRC)', re.I)


# ── COLON/OUT PARSER ──────────────────────────────────────────────────────────
def parse_colon(pages):
    entregas = []
    cur = None

    for page in pages:
        full = ' '.join(b['text'] for b in page)

        em = re.search(r'COLON/OUT/(\d+)', full)
        if em:
            eid = 'COLON/OUT/' + em.group(1)
            if not any(e['entrega'] == eid for e in entregas):
                om  = re.search(r'\b(S\d{5,6})\b', full)
                fm  = re.search(r'(\d{2}/\d{2}/\d{4})', full)
                vm  = re.search(r'Vendedor:\s*([A-ZÁÉÍÓÚ ]+)', full)
                am  = re.search(r'Almac[eé]n:\s*([A-Z ]+)', full)
                # Client: multiline box containing address
                cliente = ''
                for b in page:
                    if ('Dirección de entrega' in b['text'] or
                        'Direcci\u00f3n de entrega' in b['text']):
                        lines = [l.strip() for l in b['text'].split('\n') if l.strip()]
                        for i, l in enumerate(lines):
                            if 'entrega' in l.lower() and i + 1 < len(lines):
                                cliente = lines[i + 1]
                                break
                        break
                cur = {
                    'entrega': eid, 'tipo': 'COLON',
                    'orden':   om.group(1).strip() if om else '',
                    'fecha':   fm.group(1) if fm else '',
                    'vendedor': vm.group(1).strip() if vm else 'LEONARDO BECERRO',
                    'cliente': cliente,
                    'almacen': am.group(1).strip() if am else 'PERFECT PTY',
                    'items':   [], 'bultos': 0
                }
                entregas.append(cur)
            else:
                cur = next(e for e in entregas if e['entrega'] == eid)

        if not cur: continue
        tbm = re.search(r'Total Bultos:\s*(\d+)', full)
        if tbm: cur['bultos'] = int(tbm.group(1))

        # Product boxes: x < 130, contain [CODE]
        prod_boxes = [b for b in page if b['x'] < 130 and '[' in b['text']]

        for pb in prod_boxes:
            codes = re.findall(r'\[([^\]]+)\]', pb['text'])
            if not codes: continue
            code = codes[0].strip()
            desc = re.sub(r'\[[^\]]*\]', ' ', pb['text']).strip()
            desc = ' '.join(desc.split())

            py_top = pb['y1'] + 5
            py_bot = pb['y'] - 20  # extra room for multiline product boxes

            nearby = [b for b in page
                      if b['x'] >= 110 and b['y'] >= py_bot and b['y'] <= py_top]

            qty=None; marca=''; l=w=h=pzb=None; kg=m3=None
            bultos=0; nbultos=''; ubi='CLN/STK'

            for nb in nearby:
                nx, nt = nb['x'], nb['text'].strip()
                if SKIP.match(nt): continue

                if 110 < nx < 205:            # qty + marca "5 FUKA" / "8 PERFECT"
                    qm = re.match(r'(\d+)\s+(.+)', nt)
                    if qm: qty, marca = int(qm.group(1)), qm.group(2).strip()
                    else:
                        try: qty = int(nt)
                        except: pass
                elif 240 < nx < 310: l   = fnum(nt)
                elif 310 < nx < 375: w   = fnum(nt)
                elif 375 < nx < 445: h   = fnum(nt)
                elif 445 < nx < 515:
                    try: pzb = int(float(norm(nt)))
                    except: pass
                elif 515 < nx < 575: kg  = fnum(nt)
                elif 575 < nx < 645: m3  = fnum(nt)
                elif 645 < nx < 740:
                    bm = re.match(r'(\d+)\s+([\d-]+)', nt)
                    if bm: bultos, nbultos = int(bm.group(1)), bm.group(2)
                elif nx >= 730: ubi = nt

            if qty is not None:
                cur['items'].append({
                    'codigo': code, 'descripcion': desc,
                    'cantidad': qty, 'marca': marca,
                    'l': l, 'w': w, 'h': h, 'pzb': pzb,
                    'kg': kg, 'm3': m3,
                    'bultos': bultos, 'nbultos': nbultos,
                    'ubicacion': ubi, 'desde': '', 'barcode': ''
                })

    return entregas


# ── WH/OUT PARSER ─────────────────────────────────────────────────────────────
def parse_wh(pages):
    entregas = []
    cur = None

    for page in pages:
        full = ' '.join(b['text'] for b in page)

        em = re.search(r'WH/OUT/(\d+)', full)
        if em:
            eid = 'WH/OUT/' + em.group(1)
            if not any(e['entrega'] == eid for e in entregas):
                om = re.search(r'\b(S\d{4,6})\b', full)
                fm = re.search(r'(\d{2}/\d{2}/\d{4})', full)
                vm = re.search(r'Vendedor:\s*([A-ZÁÉÍÓÚ ]+)', full)
                # Client
                cliente = ''
                for b in page:
                    if 'Dirección de Envío' in b['text'] or 'Envio' in b['text']:
                        # Next x~38 box with y slightly below this one
                        cy = b['y']
                        cands = sorted(
                            [nb for nb in page if nb['x'] < 60 and nb['y'] < cy and nb['y'] > cy - 30],
                            key=lambda x: -x['y']
                        )
                        if cands: cliente = cands[0]['text'].strip()
                        break
                cur = {
                    'entrega': eid, 'tipo': 'WH',
                    'orden':   om.group(1) if om else '',
                    'fecha':   fm.group(1) if fm else '',
                    'vendedor': vm.group(1).strip()[:40] if vm else 'LEONARDO BECERRA',
                    'cliente': cliente, 'almacen': 'PDM/STOCK',
                    'items':   [], 'bultos': 0
                }
                entregas.append(cur)
            else:
                cur = next(e for e in entregas if e['entrega'] == eid)

        if not cur: continue

        # Detect column layout from header row
        # Look for "Cantidad" box to find qty_x
        # Look for "(cm)" boxes to find dim_x
        # This handles layout variations between WH/OUT/06883 and WH/OUT/07172
        qty_x  = None   # x of qty column
        dim_x  = None   # x of L W H PZxB box
        data_x = None   # x of kg m3 bultos box (only in 06883 layout)
        nb_x   = None   # x of N°Bultos
        desde_x= None   # x of Desde/PDM/STOCK

        for b in page:
            nt = b['text'].strip()
            if re.match(r'Cantidad\s+L', nt, re.I): qty_x = b['x']
            elif re.match(r'^\(cm\)$', nt): dim_x = b['x'] - 35 if dim_x is None else dim_x
            elif re.match(r'Desde$', nt, re.I): desde_x = b['x']
            elif re.match(r'N°\s*$|Bultos$', nt, re.I) and nb_x is None: nb_x = b['x']

        # Defaults if header not found
        if qty_x   is None: qty_x   = 309
        if dim_x   is None: dim_x   = 345
        if desde_x is None: desde_x = 560
        if nb_x    is None: nb_x    = 530

        # Build product groups from left column (x < 100)
        left  = sorted([b for b in page if b['x'] < 100], key=lambda b: -b['y1'])
        right = [b for b in page if b['x'] >= 100]

        groups = []
        grp = None
        for lb in left:
            t = lb['text']
            if SKIP.match(t): continue
            if '[' in t:
                if grp: groups.append(grp)
                grp = {'text': t, 'y1': lb['y1'], 'y': lb['y']}
            elif grp:
                grp['text'] += ' ' + t
                grp['y'] = min(grp['y'], lb['y'])
        if grp: groups.append(grp)

        for grp in groups:
            text   = grp['text']
            py_top = grp['y1'] + 5
            py_bot = grp['y'] - 5

            codes = re.findall(r'\[([^\]]+)\]', text)
            if not codes: continue
            # Merge split code fragments (e.g. "[17042-" + "0M021]")
            code = codes[0].strip()
            if code.endswith('-') and len(codes) > 1:
                code = code + codes[1].strip()

            desc = re.sub(r'\[[^\]]+\]', ' ', text).strip()
            desc = re.sub(r'\s+[A-Z]\d+N\d+\s*$', '', desc)
            desc = ' '.join(desc.split())

            nearby = [b for b in right
                      if b['y'] >= py_bot - 5 and b['y'] <= py_top]

            qty=None; l=w=h=pzb=None; kg=m3=None; bultos=0; nbultos=''; desde=''

            # Inline qty at end of product text
            im = re.search(r'\]\s+\S.*\s+(\d+)\s*$', text) or re.search(r'\]\s+(\d+)\s*$', text)
            if im: qty = int(im.group(1))

            for nb in nearby:
                nx, nt = nb['x'], nb['text'].strip()
                if SKIP.match(nt): continue
                if re.match(r'^Unidades$', nt, re.I): continue

                # qty column
                if abs(nx - qty_x) < 30 and not qty:
                    try: qty = int(nt)
                    except: pass

                # dims: "L W H PZxB" or "L W H PZxB kg m3 bultos" all in one box
                elif abs(nx - dim_x) < 40:
                    nums = [float(n.replace(',','.')) for n in re.findall(r'\d+[,.]?\d*', nt)]
                    if len(nums) >= 7:  # all-in-one layout (WH/07172)
                        l,w,h = nums[0],nums[1],nums[2]
                        pzb = int(nums[3])
                        kg, m3, bultos = nums[4], nums[5], int(nums[6])
                    elif len(nums) >= 4:  # dims + PZxB only
                        l,w,h = nums[0],nums[1],nums[2]
                        pzb = int(nums[3])

                # kg m3 bultos (separate box, WH/06883 layout)
                elif 420 < nx < 540 and kg is None:
                    nums = [float(n.replace(',','.')) for n in re.findall(r'\d+[,.]?\d*', nt)]
                    if len(nums) >= 3: kg, m3, bultos = nums[0], nums[1], int(nums[2])
                    elif len(nums) == 2: kg, m3 = nums[0], nums[1]

                # N° Bultos
                elif abs(nx - nb_x) < 40 and not nbultos:
                    if re.match(r'^[\d-]+$', nt): nbultos = nt

                # Desde / PDM/STOCK
                elif abs(nx - desde_x) < 60 or ('PDM' in nt or 'STOCK' in nt):
                    desde = nt

            if qty is not None:
                it = {
                    'codigo': code, 'descripcion': desc,
                    'cantidad': qty, 'marca': '',
                    'l': l, 'w': w, 'h': h, 'pzb': pzb,
                    'kg': kg, 'm3': m3,
                    'bultos': bultos, 'nbultos': nbultos,
                    'ubicacion': desde, 'desde': desde, 'barcode': ''
                }
                cur['items'].append(it)
                try:
                    n = int(str(nbultos).split('-')[-1])
                    cur['bultos'] = max(cur['bultos'], n)
                except: pass

    return entregas


def parse_pdf(fpath):
    pages = get_boxes(fpath)
    fmt   = detect_format(pages)
    if fmt == 'WH':
        return parse_wh(pages)
    return parse_colon(pages)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 parser.py input.pdf output.json")
        sys.exit(1)
    entregas = parse_pdf(sys.argv[1])
    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        json.dump(entregas, f, ensure_ascii=False, indent=2)
    total = sum(len(e['items']) for e in entregas)
    print(f"OK: {len(entregas)} entregas, {total} items → {sys.argv[2]}")
