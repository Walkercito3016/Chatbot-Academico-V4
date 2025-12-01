// Configuración global
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// Estado
let pdfFiles = [], pdfTexts = [], currentPdfIndex = 0, seccionActual = null, guiaActual = null, seccionesGuia = [];
let isRecording = false, recognition = null;

// DOM Elements
const DOM = {
  chat: document.getElementById("chat-container"),
  input: document.getElementById("user-input"),
  sendBtn: document.getElementById("send-btn"),
  summaryBtn: document.getElementById("summary-btn"),
  referencesBtn: document.getElementById("references-btn"),
  consistencyBtn: document.getElementById("consistency-matrix-btn"),
  voiceBtn: document.getElementById("voice-btn"),
  detectAIBtn: document.getElementById("detect-ai-btn"),
  pdfUpload: document.getElementById("pdf-upload"),
  pdfSelector: document.getElementById("pdf-selector"),
  fileName: document.getElementById("file-names"),
  thumbnails: document.getElementById("pdf-thumbnails")
};

// Utilidades
const renderMessage = ({text, sender = 'bot', markdown = true, icon = '', extraClass = ''}) => {
  const div = document.createElement('div');
  div.className = `message ${sender}-message ${extraClass}`;
  let content = icon ? `<span class="${icon}"></span>` : '';
  content += (markdown && sender === 'bot') 
    ? new showdown.Converter({tables: true, emoji: true, strikethrough: true, underline: true}).makeHtml(text)
    : text;
  div.innerHTML = content;
  DOM.chat.appendChild(div);
  DOM.chat.scrollTop = DOM.chat.scrollHeight;
};

const setButtonsDisabled = (disabled) => {
  [DOM.sendBtn, DOM.summaryBtn, DOM.referencesBtn, DOM.consistencyBtn].forEach(btn => btn.disabled = disabled);
  DOM.input.disabled = disabled;
};

const showLoading = (text = 'Procesando...') => renderMessage({text, sender: 'bot', markdown: false, extraClass: 'loading'});
const hideLoading = () => document.querySelectorAll('.loading').forEach(div => div.remove());
const showError = (text) => renderMessage({text, sender: 'bot', markdown: false, icon: 'icon-error', extraClass: 'error-message'});

// Manejo de PDFs
const handlePDFsUpload = async (e) => {
  const files = Array.from(e.target.files).filter(f => f.type === 'application/pdf').slice(0, 5);
  if (!files.length) return;
  
  pdfFiles = files;
  currentPdfIndex = 0;
  pdfTexts = [];
  renderPdfButtons();
  setButtonsDisabled(true);
  showLoading('Procesando PDFs...');
  
  try {
    pdfTexts = await Promise.all(files.map(async (file) => {
      renderMessage({text: `Procesando ${file.name}...`, sender: "bot", markdown: false});
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join('');
      }
      renderMessage({text: `PDF cargado: ${file.name}`, sender: "bot", markdown: false});
      return {name: file.name, text};
    }));
    await loadPDFbyIndex(0);
  } catch (err) {
    showError("Error procesando PDFs: " + err.message);
  } finally {
    hideLoading();
    setButtonsDisabled(false);
  }
};

const renderPdfButtons = () => {
  DOM.pdfSelector.innerHTML = '';
  pdfFiles.forEach((file, idx) => {
    const btn = document.createElement('button');
    btn.textContent = file.name.length > 20 ? file.name.substring(0, 17) + "..." : file.name;
    btn.className = `pdf-select-btn${idx === currentPdfIndex ? " selected" : ""}`;
    btn.onclick = () => {
      if (idx !== currentPdfIndex) {
        currentPdfIndex = idx;
        loadPDFbyIndex(idx);
        renderPdfButtons();
      }
    };
    DOM.pdfSelector.appendChild(btn);
  });
};

const loadPDFbyIndex = async (idx) => {
  if (!pdfFiles[idx]) return;
  DOM.fileName.textContent = pdfFiles[idx].name;
  const arrayBuffer = await pdfFiles[idx].arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
  await renderThumbnails(pdf);
  renderMessage({
    text: `PDF cargado: ${pdfFiles[idx].name}, ${pdf.numPages} páginas.\nYa puedes preguntar o pedir análisis comparativo.`,
    sender: "bot", markdown: false
  });
  setButtonsDisabled(false);
  DOM.input.focus();
};

const renderThumbnails = async (pdf) => {
  DOM.thumbnails.innerHTML = '';
  const maxThumbs = Math.min(pdf.numPages, 5);
  for (let i = 1; i <= maxThumbs; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({scale: 0.2});
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.cursor = 'pointer';
    canvas.title = `Ir a página ${i}`;
    await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
    canvas.onclick = () => alert(`Ir a página ${i}`);
    DOM.thumbnails.appendChild(canvas);
  }
};

// Enviar mensaje
const sendMessage = async () => {
  const question = DOM.input.value.trim();
  if (!question) return;
  
  if (/^(hola|ola|buenas|saludos|hey|hello)\b/i.test(question)) {
    renderMessage({text: question, sender: "user"});
    renderMessage({
      text: "¡Hola! Soy tu asistente de informes y artículos académicos. Puedo ayudarte a resumir PDFs, buscar artículos, generar matrices de consistencia y parafrasear textos. ¿Cómo te gustaría empezar?",
      sender: "bot"
    });
    DOM.input.value = '';
    DOM.input.focus();
    return;
  }
  
  renderMessage({text: question, sender: 'user'});
  setButtonsDisabled(true);
  showLoading('Analizando y generando respuesta...');
  
  try {
    let response = "";
    if (pdfFiles.length > 1 && /semejanza|similitud|diferencia|compar|metodolog/i.test(question)) {
      const prompt = buildComparativePrompt(question, pdfTexts);
      response = await generateResponseWithPerplexity(prompt, null, false);
    } else {
      response = await generateResponseWithPerplexity(question, pdfTexts[currentPdfIndex]?.text, false);
    }
    hideLoading();
    renderMessage({text: response, sender: "bot"});
    saveToHistory(question, response);
  } catch (err) {
    hideLoading();
    showError("Error al generar respuesta: " + err.message);
  } finally {
    setButtonsDisabled(false);
    DOM.input.focus();
  }
  DOM.input.value = '';
};

const buildComparativePrompt = (question, pdfTexts) => {
  let prompt = `Analiza y compara los siguientes PDFs, respondiendo la pregunta "${question}". Cita diferencias, semejanzas y aspectos metodológicos en formato Markdown tablas. `;
  pdfTexts.forEach((pdf, idx) => {
    prompt += `\nPDF ${idx + 1}: "${pdf.name}" (primeras 3000 caracteres)\n${pdf.text.substring(0, 3000)}`;
  });
  return prompt;
};

// Historial
const saveToHistory = (question, answer) => {
  let history = JSON.parse(localStorage.getItem('chatHistory') || "[]");
  history.unshift({question, answer, date: new Date().toLocaleString()});
  localStorage.setItem('chatHistory', JSON.stringify(history));
  renderHistory();
};

const renderHistory = () => {
  const container = document.getElementById("history-list");
  if (!container) return;
  const history = JSON.parse(localStorage.getItem('chatHistory') || "[]");
  container.innerHTML = history.length ? '' : '<p class="no-history">No hay chats guardados.</p>';
  history.forEach(item => {
    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `<div class="history-date">${item.date}</div><div class="history-question">${item.question}</div>`;
    div.onclick = () => {
      renderMessage({text: item.question, sender: "user"});
      renderMessage({text: item.answer, sender: "bot"});
    };
    container.appendChild(div);
  });
};

// Reconocimiento de voz
const initRecognition = () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Tu navegador no admite reconocimiento de voz.");
    return null;
  }
  const rec = new SpeechRecognition();
  rec.lang = "es-ES";
  rec.interimResults = true;
  rec.continuous = true;
  return rec;
};

const stopRecognition = () => {
  isRecording = false;
  DOM.voiceBtn.style.background = "";
  DOM.voiceBtn.style.color = "";
  DOM.voiceBtn.textContent = "Dictar pregunta";
  DOM.voiceBtn.title = "Dictar por voz";
};

DOM.voiceBtn.onclick = () => {
  if (!recognition) recognition = initRecognition();
  if (!recognition) return;
  
  if (!isRecording) {
    recognition.start();
    isRecording = true;
    DOM.voiceBtn.style.background = "#fa5252";
    DOM.voiceBtn.style.color = "#fff";
    DOM.voiceBtn.textContent = "Detener dictado";
    let finalTranscript = "";
    recognition.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
      }
      DOM.input.value = finalTranscript;
      DOM.input.focus();
    };
    recognition.onerror = e => { alert("Error: " + e.error); stopRecognition(); };
    recognition.onend = stopRecognition;
  } else {
    recognition.stop();
  }
};

// Funciones de análisis
const generateSummary = async () => {
  renderMessage({text: "Generar resumen del PDF", sender: "user"});
  DOM.summaryBtn.disabled = true;
  showLoading('Generando resumen...');
  try {
    const summary = await generateSummaryWithPerplexity(pdfTexts[currentPdfIndex].text);
    hideLoading();
    renderMessage({text: summary, sender: "bot"});
  } catch (err) {
    hideLoading();
    showError("Error: " + err.message);
  } finally {
    DOM.summaryBtn.disabled = false;
  }
};

const recommendScholarArticles = async () => {
  renderMessage({text: "Buscando revistas y artículos académicos...", sender: "user"});
  DOM.referencesBtn.disabled = true;
  showLoading('Buscando referencias...');
  try {
    const pdfText = pdfTexts[currentPdfIndex].text;
    const firstLines = pdfText.split("\n").filter(e => e.trim().length > 15).slice(0, 3).join(" ");
    const titleMatch = pdfText.match(/titulo|title|abstract|resumen.{10,80}/i);
    const tema = titleMatch ? titleMatch[2].trim() || firstLines : firstLines;
    const response = await fetch("http://localhost:3001/api/scholar?q=" + encodeURIComponent(tema));
    const result = await response.text();
    hideLoading();
    renderMessage({text: result, sender: "bot"});
  } catch (err) {
    hideLoading();
    showError("Error: " + err.message);
  } finally {
    DOM.referencesBtn.disabled = false;
  }
};

const generateConsistencyMatrix = async () => {
  renderMessage({text: "Generando matriz de consistencia...", sender: "user"});
  DOM.consistencyBtn.disabled = true;
  showLoading('Generando matriz...');
  const contexto = pdfTexts[currentPdfIndex].text.substring(0, 2000);
  const prompt = `Genera una matriz de consistencia académica (problema, objetivo general, objetivos específicos, variables, hipótesis, indicadores) en formato Markdown:\n${contexto}. Si falta información, indícalo con "por definir".`;
  try {
    const respuesta = await generateResponse(prompt, null, false);
    hideLoading();
    renderMessage({text: respuesta, sender: "bot"});
  } catch (err) {
    hideLoading();
    showError("Error: " + err.message);
  } finally {
    DOM.consistencyBtn.disabled = false;
  }
};

// Detectar IA
DOM.detectAIBtn.onclick = async () => {
  const input = DOM.input.value.trim();
  if (!input) return renderMessage({text: "Escribe un texto para analizar.", sender: "bot", icon: "icon-info"});
  DOM.detectAIBtn.disabled = true;
  showLoading('Analizando con ZeroGPT...');
  try {
    const response = await fetch("/api/zerogpt", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text: input})
    });
    const result = await response.json();
    hideLoading();
    renderMessage({text: "Resultado ZeroGPT: " + JSON.stringify(result, null, 2), sender: "bot"});
  } catch (e) {
    hideLoading();
    showError("Error: " + e.message);
  }
  DOM.detectAIBtn.disabled = false;
};

// Descargar chat
document.getElementById("download-chat-btn")?.addEventListener("click", () => {
  const chatElems = document.querySelectorAll(".chat-container .message");
  let chatText = "";
  chatElems.forEach(el => {
    const who = el.classList.contains("user-message") ? "Tú: " : "Bot: ";
    chatText += who + (el.innerText || el.textContent) + "\n\n";
  });
  const doc = new window.jspdf.jsPDF();
  const pageHeight = doc.internal.pageSize.height - 20;
  const lines = doc.splitTextToSize(chatText, 180);
  let y = 10;
  lines.forEach(line => {
    if (y > pageHeight) { doc.addPage(); y = 10; }
    doc.text(line, 10, y);
    y += 8;
  });
  doc.save("chat_con_asistente.pdf");
});

// ============================================
// GUÍAS ACADÉMICAS CON BOTÓN RETROCEDER
// ============================================

const titulosPorGuia = {
  'guia_tesis.pdf': ["Carátula", "Introducción", "Metodología", "Resultados", "Discusión", "Conclusiones", "Recomendaciones", "Propuesta", "Referencias", "Anexos"],
  'guia_proyecto_investigacion.pdf': ["Carátula", "Introducción", "Metodología", "Aspectos Administrativos", "Referencias", "Anexos"],
  'guia_proyecto_trabajo_academico.pdf': ["Carátula", "Introducción", "Metodología", "Aspectos Administrativos", "Referencias", "Anexos"],
  'guia_trabajo_academico.pdf': ["Carátula", "Introducción", "Metodología", "Resultados", "Discusión", "Conclusiones", "Recomendaciones", "Referencias", "Anexos"]
};

const pdfGuiasRutas = {
  'guia_tesis.pdf': '/chatbot-V3-2/guiaspdf/guia_tesis.pdf',
  'guia_proyecto_investigacion.pdf': 'https://github.com/Walkercito3016/Chatbot-Academico-V4/blob/main/guiaspdf/guia_proyecto_investigacion.pdf',
  'guia_proyecto_trabajo_academico.pdf': '/chatbot-V3-2/guiaspdf/guia_proyecto_trabajo_academico.pdf',
  'guia_trabajo_academico.pdf': '/chatbot-V3-2/guiaspdf/guia_trabajo_academico.pdf'
};

// Estado de la guía
let seccionIndexActual = 0;
let guiaSeleccionada = null;

const cargarGuia = async (pdfFileName) => {
  guiaSeleccionada = pdfFileName;
  seccionIndexActual = 0;
  
  const pdf = await pdfjsLib.getDocument(pdfGuiasRutas[pdfFileName]).promise;
  let texto = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    texto += content.items.map(item => item.str).join(' ');
  }
  seccionesGuia = extraerSeccionesDeGuia(texto, titulosPorGuia[pdfFileName]);
  mostrarSeccionesEnUI(seccionesGuia);
};

const extraerSeccionesDeGuia = (texto, titulosArray) => {
  const partes = [];
  const lowerTexto = texto.toLowerCase();
  let start = 0;
  titulosArray.forEach((titulo, idx) => {
    const startIdx = lowerTexto.indexOf(titulo.toLowerCase(), start);
    if (startIdx === -1) return;
    const endIdx = idx < titulosArray.length - 1 
      ? lowerTexto.indexOf(titulosArray[idx + 1].toLowerCase(), startIdx + 1) 
      : texto.length;
    partes.push({nombre: titulo, contenido: texto.substring(startIdx, endIdx !== -1 ? endIdx : texto.length).trim()});
    start = endIdx;
  });
  return partes;
};

const mostrarSeccionesEnUI = (secciones) => {
  const contenedor = document.getElementById('panel-seleccion-seccion');
  contenedor.innerHTML = '';
  
  secciones.forEach((sec, idx) => {
    const btn = document.createElement('button');
    btn.textContent = sec.nombre;
    btn.onclick = () => {
      mostrarAyudaEnChat(sec);
      seccionIndexActual = idx + 1;
      
      // Si es la última sección, mostrar botón retroceder
      if (seccionIndexActual >= secciones.length) {
        setTimeout(() => mostrarBotonRetroceder(), 500);
      }
    };
    contenedor.appendChild(btn);
  });
  
  contenedor.style.display = 'flex';
};

const mostrarAyudaEnChat = (seccion) => {
  seccionActual = seccion;
  renderMessage({text: `### Requisitos para **${seccion.nombre}**\n\n${seccion.contenido}`, sender: "bot"});
  renderMessage({text: "ℹ️ ¿Tienes alguna pregunta sobre esta sección?", sender: "bot"});
};

// Mostrar botón de retroceder
function mostrarBotonRetroceder() {
  // Verificar si ya existe un botón de retroceder
  const botonExistente = document.querySelector('.btn-retroceder-container');
  if (botonExistente) return;
  
  const btnContainer = document.createElement('div');
  btnContainer.className = 'btn-retroceder-container';
  
  const btn = document.createElement('button');
  btn.className = 'btn-retroceder';
  btn.innerHTML = '<span class="arrow">←</span> Volver al inicio';
  btn.onclick = reiniciarGuia;
  
  btnContainer.appendChild(btn);
  DOM.chat.appendChild(btnContainer);
  DOM.chat.scrollTop = DOM.chat.scrollHeight;
}

// Reiniciar guía
function reiniciarGuia() {
  seccionIndexActual = 0;
  guiaSeleccionada = null;
  
  // Remover botón de retroceder
  const botonExistente = document.querySelector('.btn-retroceder-container');
  if (botonExistente) {
    botonExistente.remove();
  }
  
  // Mensaje de reinicio
  renderMessage({
    text: '🔄 Guía reiniciada. Puedes seleccionar una nueva guía o continuar con otra opción.',
    sender: 'bot'
  });
  
  // Mostrar panel de selección de guía
  const panelGuia = document.getElementById('panel-seleccion-guia');
  if (panelGuia) {
    panelGuia.style.display = 'flex';
  }
  
  // Ocultar panel de secciones
  const panelSeccion = document.getElementById('panel-seleccion-seccion');
  if (panelSeccion) {
    panelSeccion.style.display = 'none';
  }
}

// ============================================
// ESTILOS CSS PARA BOTÓN RETROCEDER
// ============================================
const estilosGuias = `
/* Contenedor del botón de retroceder */
.btn-retroceder-container {
  display: flex;
  justify-content: center;
  margin: 20px 0;
  padding: 10px;
  animation: fadeIn 0.5s ease;
}

/* Botón de retroceder */
.btn-retroceder {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  padding: 14px 35px;
  font-size: 16px;
  font-weight: 600;
  border-radius: 30px;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: inherit;
}

.btn-retroceder:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 25px rgba(102, 126, 234, 0.6);
  background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
}

.btn-retroceder:active {
  transform: translateY(-1px);
  box-shadow: 0 3px 15px rgba(102, 126, 234, 0.5);
}

/* Flecha en el botón */
.btn-retroceder .arrow {
  font-size: 18px;
  font-weight: bold;
  transition: transform 0.3s ease;
}

.btn-retroceder:hover .arrow {
  transform: translateX(-3px);
}

/* Animación de aparición */
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
`;

// Insertar estilos en el documento
const insertarEstilosGuias = () => {
  const styleSheet = document.createElement("style");
  styleSheet.id = "estilos-guias-chatbot";
  styleSheet.textContent = estilosGuias;
  
  if (!document.getElementById("estilos-guias-chatbot")) {
    document.head.appendChild(styleSheet);
  }
};

// Ejecutar al cargar
insertarEstilosGuias();

// ============================================
// EVENT LISTENERS
// ============================================
DOM.pdfUpload.addEventListener("change", handlePDFsUpload);
DOM.sendBtn.addEventListener("click", sendMessage);
DOM.input.addEventListener("keypress", e => {
  if (e.key === "Enter" && !DOM.sendBtn.disabled && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
DOM.summaryBtn.addEventListener("click", generateSummary);
DOM.referencesBtn.addEventListener("click", recommendScholarArticles);
DOM.consistencyBtn.addEventListener("click", generateConsistencyMatrix);

document.querySelectorAll('.btn-guia').forEach(btn => {
  btn.onclick = async () => {
    await cargarGuia(btn.getAttribute('data-pdf'));
    document.getElementById('panel-seleccion-guia').style.display = 'none';
    document.getElementById('panel-seleccion-seccion').style.display = 'flex';
  };
});

document.addEventListener('DOMContentLoaded', renderHistory);
// ============================================
// AGREGA ESTO AL FINAL DE TU chatbot.js
// ============================================

// Modificar la función mostrarSeccionesEnUI existente
const mostrarSeccionesEnUIOriginal = mostrarSeccionesEnUI;

window.mostrarSeccionesEnUI = function(secciones) {
  const contenedor = document.getElementById('panel-seleccion-seccion');
  contenedor.innerHTML = '';
  
  secciones.forEach((sec, idx) => {
    const btn = document.createElement('button');
    btn.textContent = sec.nombre;
    btn.onclick = () => {
      mostrarAyudaEnChat(sec);
      
      // Si es la última sección, mostrar botón de retroceder
      if (idx === secciones.length - 1) {
        setTimeout(() => {
          agregarBotonRetroceder();
        }, 800);
      }
    };
    contenedor.appendChild(btn);
  });
  
  contenedor.style.display = 'flex';
};

// Función para agregar el botón de retroceder
function agregarBotonRetroceder() {
  // Verificar si ya existe
  if (document.querySelector('.btn-retroceder-container')) return;
  
  const chatContainer = document.getElementById('chat-container');
  
  // Crear contenedor del botón
  const btnContainer = document.createElement('div');
  btnContainer.className = 'btn-retroceder-container';
  btnContainer.style.cssText = `
    display: flex;
    justify-content: center;
    margin: 20px 0;
    padding: 10px;
    animation: fadeIn 0.5s ease;
  `;
  
  // Crear botón
  const btn = document.createElement('button');
  btn.className = 'btn-retroceder';
  btn.innerHTML = '← Volver al inicio de guías';
  btn.style.cssText = `
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    padding: 14px 35px;
    font-size: 16px;
    font-weight: 600;
    border-radius: 30px;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
  `;
  
  btn.onmouseover = () => {
    btn.style.transform = 'translateY(-3px)';
    btn.style.boxShadow = '0 6px 25px rgba(102, 126, 234, 0.6)';
  };
  
  btn.onmouseout = () => {
    btn.style.transform = 'translateY(0)';
    btn.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)';
  };
  
  btn.onclick = () => {
    // Remover botón
    btnContainer.remove();
    
    // Reiniciar
    seccionIndexActual = 0;
    guiaSeleccionada = null;
    
    // Mostrar mensaje
    renderMessage({
      text: '🔄 **Guía reiniciada.** Puedes seleccionar una nueva guía desde el menú lateral.',
      sender: 'bot'
    });
    
    // Ocultar panel de secciones
    const panelSeccion = document.getElementById('panel-seleccion-seccion');
    if (panelSeccion) {
      panelSeccion.style.display = 'none';
    }
    
    // Mostrar panel de guías si existe
    const panelGuia = document.getElementById('panel-seleccion-guia');
    if (panelGuia) {
      panelGuia.style.display = 'flex';
    }
  };
  
  btnContainer.appendChild(btn);
  chatContainer.appendChild(btnContainer);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Agregar animación CSS si no existe
if (!document.getElementById('estilos-boton-retroceder')) {
  const style = document.createElement('style');
  style.id = 'estilos-boton-retroceder';
  style.textContent = `
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `;
  document.head.appendChild(style);
}


console.log('✅ Sistema de botón retroceder cargado correctamente');
