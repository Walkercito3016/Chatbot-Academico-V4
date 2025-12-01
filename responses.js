// ==================== API KEYS (Cambia por variables de entorno si vas a producción) ====================
const PERPLEXITY_API_KEY = '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';
const SERPAPI_KEY = '45f1979cf72b80f11f1ead957c45bf84442902af58bfabce07d01745bc4197e8';

// ==================== Consulta a Perplexity (modelo "sonar") ====================
// Permite responder preguntas académicas, analizar PDFs o comparar múltiples PDFs.
// Si useWebSearch = true, realiza búsqueda web para enriquecer la respuesta.
async function generateResponseWithPerplexity(question, pdfTextOrArray, useWebSearch = false) {
    try {
        let context = "";
        // Si recibimos varios PDFs se arma un contexto comparativo
        if (Array.isArray(pdfTextOrArray)) {
            context = "Comparativa entre los PDFs enviados:\n";
            pdfTextOrArray.forEach((pdfObj, idx) => {
                context += `PDF ${idx + 1}: ${pdfObj.name}\n${pdfObj.text.substring(0, 3500)}\n\n`;
            });
        } else if (pdfTextOrArray && pdfTextOrArray.trim().length > 30) {
            context = `Contexto extraído del PDF:\n${pdfTextOrArray.substring(0, 3500)}\n\n`;
        }

        const endpoint = "https://api.perplexity.ai/chat/completions";
        const payload = {
            model: "sonar",
            messages: [
                {
                    role: "system",
                    content: `
Eres un asistente académico experto en generar reportes con rigor científico.
Si el usuario pide análisis o reportes, realiza búsqueda en Internet (cuando esté habilitado),
compara las fuentes y cita los enlaces o revistas científicas en formato APA o similar.
Usa formato Markdown con títulos, listas y tablas si corresponde.
`
                },
                {
                    role: "user",
                    content: `${context}Pregunta del usuario: ${question}`
                }
            ],
            max_tokens: 1200,
            temperature: 0.4
        };

        if (useWebSearch) {
            payload.search_mode = "web";
        }

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errTxt = await response.text();
            console.error("Error Perplexity:", errTxt);
            return "❌ Error Perplexity: " + errTxt;
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || "Sin respuesta generada.";
    } catch (error) {
        console.error("Error inesperado:", error);
        return "❌ Error inesperado al consultar Perplexity.";
    }
}

// ==================== Consulta académica con Google Scholar vía SerpApi ====================
// Busca artículos académicos sobre un tema. Formatea resultados como Markdown.
async function searchGoogleScholar(query, maxResults = 5) {
    try {
        const endpoint = `https://serpapi.com/search.json`;
        const params = new URLSearchParams({
            engine: 'google_scholar',
            q: query,
            api_key: SERPAPI_KEY,
            num: maxResults,
            hl: 'es'
        });
        const response = await fetch(`${endpoint}?${params}`);
        if (!response.ok) throw new Error(`Error en SerpApi: ${response.status}`);
        const data = await response.json();
        if (!data.organic_results || data.organic_results.length === 0) {
            return "No se encontraron artículos académicos para esta búsqueda.";
        }
        let formattedResults = `## 📚 Artículos Académicos sobre: "${query}"\n\n`;
        formattedResults += `Se encontraron ${data.search_information?.total_results?.toLocaleString() || '?'} resultados. Aquí están los más relevantes:\n\n`;
        data.organic_results.slice(0, maxResults).forEach((article, index) => {
            formattedResults += `### ${index + 1}. ${article.title}\n\n`;
            if (article.publication_info && article.publication_info.summary) {
                formattedResults += `**Autores:** ${article.publication_info.summary}\n\n`;
            }
            if (article.snippet) {
                formattedResults += `**Resumen:** ${article.snippet}\n\n`;
            }
            if (article.link) {
                formattedResults += `**Enlace:** [Acceder al artículo](${article.link})\n\n`;
            }
            if (article.inline_links && article.inline_links.cited_by) {
                formattedResults += `**Citado por:** ${article.inline_links.cited_by.total} publicaciones\n\n`;
            }
            if (article.resources && article.resources.length > 0) {
                formattedResults += `**Recursos:** `;
                article.resources.forEach(resource => {
                    formattedResults += `[${resource.file_format} - ${resource.title}](${resource.link}) `;
                });
                formattedResults += `\n\n`;
            }
            formattedResults += `---\n\n`;
        });
        return formattedResults;
    } catch (error) {
        return `Error al consultar Google Scholar: ${error.message}`;
    }
}

// ==================== Lógica inteligente de respuesta según el input ====================
// Decide si buscar artículos académicos o analizar el PDF con Perplexity.
// Ejemplo: Si pregunta "Dame artículos sobre IA" busca con Scholar. Si pregunta análisis, usa Perplexity.
let lastTopic = '';
async function generateResponse(question, pdfTextOrArray) {
    try {
        // Detecta el tema principal del input
        const topicMatch = question.match(/sobre (.+?)[?.]|de (.+?)[?.]|del tema (.+?)[?.]|acerca de (.+?)[?.]/i)
            || question.match(/(.+?)(?:\?|$)/);
        if (topicMatch && !/artículo|paper/i.test(question)) {
            lastTopic = topicMatch[1] || topicMatch[2] || topicMatch[3] || topicMatch[4] || topicMatch[0];
            lastTopic = lastTopic.trim().replace(/[\?.,]/g, '');
        }

        // Palabras clave para activar búsqueda académica
        const keywords = /artículos?|papers?|publicaciones?|investigaciones?|referencias? académicas?|bibliografía|dame (artículos|papers|publicaciones)|quiero (artículos|papers|referencias)|búscame|scholar/i;
        if (keywords.test(question)) {
            let searchQuery = '';
            const topicInQuestion = question.match(/sobre (.+?)(?:\?|$)|de (.+?)(?:\?|$)|del tema (.+?)(?:\?|$)|acerca de (.+?)(?:\?|$)|referente a (.+?)(?:\?|$)/i);
            if (topicInQuestion) {
                searchQuery = topicInQuestion[1] || topicInQuestion[2] || topicInQuestion[3] || topicInQuestion[4] || topicInQuestion[5];
            } else if (lastTopic) {
                searchQuery = lastTopic;
            } else {
                searchQuery = question.replace(keywords, '').trim();
            }
            searchQuery = searchQuery.trim().replace(/[\?.,;]/g, '');
            if (!searchQuery || searchQuery.length < 3) {
                return "Por favor, especifica sobre qué tema deseas buscar artículos académicos. Ejemplo: 'Dame artículos sobre inteligencia artificial'.";
            }
            return await searchGoogleScholar(searchQuery);
        }

        // Por defecto, consulta a Perplexity enriquecida con búsqueda web
        return await generateResponseWithPerplexity(question, pdfTextOrArray, true);
    } catch (error) {
        return 'Lo siento, ocurrió un error al procesar tu solicitud.';
    }
}

// ==================== Resumen de PDF usando Perplexity ====================
// Recibe texto de PDF, opcionalmente extiende para recibir varios PDFs.
async function generateSummaryWithPerplexity(pdfTextOrArray) {
    return await generateResponseWithPerplexity(
        "Hazme un resumen del documento (tema principal, ideas clave, conclusiones).",
        pdfTextOrArray,
        false
    );
}

// ==================== Recomendación de revistas y artículos usando Perplexity ====================
// Pensado para botón UI "Referencias PDF"
async function generateReferencesWithPerplexity(pdfTextOrArray) {
    return await generateResponseWithPerplexity(
        "Recomienda revistas científicas y artículos sobre el tema del PDF.",
        pdfTextOrArray,
        true
    );
}

// ==================== FIN RESPONSES.JS ====================
