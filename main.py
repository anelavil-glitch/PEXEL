import os, json, io, tempfile, re
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from parser_pdf import parse_pdf
from exporter import export_to_excel

app = FastAPI(title="Packing List Manager")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def root():
    return FileResponse("static/index.html")

@app.get("/manifest.json")
def manifest():
    return FileResponse("static/manifest.json")

@app.get("/sw.js")
def sw():
    return FileResponse("static/sw.js")

@app.post("/parse")
async def parse(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Solo se aceptan archivos PDF")
    content = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        entregas = parse_pdf(tmp_path)
        for e in entregas:
            e["fileName"] = file.filename
        return {"ok": True, "entregas": entregas,
                "total_items": sum(len(e["items"]) for e in entregas)}
    except Exception as ex:
        raise HTTPException(500, str(ex))
    finally:
        os.unlink(tmp_path)

@app.post("/export")
async def export(payload: dict):
    entregas = payload.get("entregas", [])
    if not entregas:
        raise HTTPException(400, "Sin datos para exportar")
    buf = io.BytesIO()
    export_to_excel(entregas, buf)
    buf.seek(0)
    fname = payload.get("filename", "PL-Manager.xlsx")
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'}
    )

@app.get("/health")
def health():
    return {"status": "ok"}
