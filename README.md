# Packing List Manager

Aplicación web para procesar packing lists PDF de PERFECT PTY y PARQUE DEL MAR 37D.
Soporta formatos COLON/OUT y WH/OUT.

## Deploy gratuito en Railway (recomendado)

### Opción A — GitHub + Railway (más fácil)

1. **Subí el código a GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Packing List Manager"
   gh repo create pl-manager --public --push
   ```

2. **Deploy en Railway:**
   - Entrá a https://railway.app
   - "New Project" → "Deploy from GitHub repo"
   - Seleccioná tu repo
   - Railway detecta Python automáticamente con `requirements.txt`
   - En 2 minutos tenés una URL pública tipo `https://pl-manager-xxxx.up.railway.app`

3. **Compartí el link** con tu equipo — funciona en cualquier navegador

### Opción B — Railway CLI (sin GitHub)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

## Deploy en Render (alternativa gratuita)

1. Entrá a https://render.com → "New Web Service"
2. Conectá tu GitHub repo o subí los archivos
3. Configuración:
   - **Runtime:** Python 3
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`

## Correr localmente

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
Abrí http://localhost:8000

## Estructura de archivos

```
├── main.py           # Servidor FastAPI (API + serve frontend)
├── parser_pdf.py     # Parser PDF (pdfminer, coordenadas X/Y)
├── exporter.py       # Exportador Excel (openpyxl, 3 hojas)
├── requirements.txt
├── Procfile
├── railway.json
└── static/
    ├── index.html    # Frontend PWA
    ├── manifest.json
    ├── sw.js
    └── icons/
```

## API Endpoints

- `POST /parse` — Sube un PDF, devuelve JSON con entregas y productos
- `POST /export` — Recibe JSON con entregas, devuelve archivo .xlsx
- `GET /health` — Health check
