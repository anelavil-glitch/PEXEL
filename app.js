document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const dropzone = document.getElementById('dropzone');
    const btnSelectFile = document.getElementById('btn-select-file');

    // 1. Activar el explorador de archivos al hacer clic en el botón
    btnSelectFile.addEventListener('click', () => {
        fileInput.click();
    });

    // 2. Activar el explorador al hacer clic directamente en la zona de drop
    dropzone.addEventListener('click', () => {
        fileInput.click();
    });

    // 3. Escuchar cuando se seleccionan archivos desde el explorador
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    // 4. Lógica de Drag & Drop (Arrastrar y Soltar)
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
    });

    // 5. Procesar los archivos seleccionados
    function handleFiles(files) {
        const pdfFiles = Array.from(files).filter(f => f.type === 'application/pdf');
        
        if (pdfFiles.length === 0) {
            showNotification("Por favor, selecciona solo archivos PDF.", "error");
            return;
        }

        pdfFiles.forEach(file => {
            showNotification(`Archivo detectado: ${file.name}`, "success");
            console.log("Listo para procesar con PDF.js:", file.name);
            // Aquí se activará la lectura del PDF más adelante
        });
    }

    // Función para mostrar mensajes en pantalla
    function showNotification(msg, type) {
        const notifArea = document.getElementById('notifications');
        const n = document.createElement('div');
        n.className = `notif notif-${type}`;
        n.textContent = msg;
        notifArea.appendChild(n);
        setTimeout(() => n.remove(), 4000);
    }
});