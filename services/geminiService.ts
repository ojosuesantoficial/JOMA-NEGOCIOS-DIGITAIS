import { GoogleGenAI, GenerateContentResponse, Modality, Type, FunctionDeclaration } from "@google/genai";
import { MAX_OUTPUT_TOKENS_PER_CHUNK, CHUNK_WORD_COUNT_TARGET } from '../constants';
import { languageMap, sanitizeStoryText } from '../utils/appUtils'; // Import languageMap and sanitizeStoryText from appUtils
import { decode, decodeAudioData } from '../utils/audioUtils'; // Import decoding utilities

/**
 * Helper function to extract error details from Gemini API responses.
 * It can parse standard Error objects whose message is stringified JSON,
 * or raw error objects from the API.
 * @param error The error object caught from an API call.
 * @returns An object containing the extracted error message, code, status, and retry delay.
 */
export function parseGeminiError(error: any): { errorMessage: string; errorCode?: number; statusMessage?: string; retryDelayMs?: number } {
  let errorMessage = "Erro desconhecido da API do Gemini.";
  let errorCode: number | undefined;
  let statusMessage: string | undefined;
  let retryDelayMs: number | undefined;

  // Check if error is an instance of Error with a JSON string message
  if (error instanceof Error && typeof error.message === 'string') {
    errorMessage = error.message; // Default to raw message
    try {
      const errorObj = JSON.parse(error.message);
      if (errorObj && errorObj.error) {
        errorMessage = errorObj.error.message;
        errorCode = errorObj.error.code;
        statusMessage = errorObj.error.status;

        if (errorObj.error.details && Array.isArray(errorObj.error.details)) {
          for (const detail of errorObj.error.details) {
            if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' && detail.retryDelay) {
              const delayString = detail.retryDelay;
              const match = delayString.match(/(\d+\.?\d*)s/);
              if (match && match[1]) {
                retryDelayMs = parseFloat(match[1]) * 1000;
              }
            }
          }
        }
      }
    } catch (parseError) {
      // If parsing fails, it's not a JSON string, so errorMessage remains the original error.message
    }
  } else if (typeof error === 'object' && error !== null && 'error' in error) {
    // Direct API error object structure
    const apiError = (error as any).error;
    if (apiError && apiError.message) {
      errorMessage = apiError.message;
      errorCode = apiError.code;
      statusMessage = apiError.status;

      if (apiError.details && Array.isArray(apiError.details)) {
        for (const detail of apiError.details) {
          if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' && detail.retryDelay) {
            const delayString = detail.retryDelay;
            const match = delayString.match(/(\d+\.?\d*)s/);
            if (match && match[1]) {
              retryDelayMs = parseFloat(match[1]) * 1000;
            }
          }
        }
      }
    }
  }

  // Enhance common internal error messages with user-friendly text
  if (errorMessage.includes("Internal error encountered")) {
    errorMessage = "Ocorreu um erro interno nos servidores do Gemini. Por favor, tente novamente mais tarde.";
  }
  // Add more specific translations/suggestions for other common errors if needed.

  return { errorMessage, errorCode, statusMessage, retryDelayMs };
}

interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  onRetryWait?: (delayMs: number, retriesLeft: number, errorMessage: string) => void; // New optional callback
}

/**
 * A generic helper function to handle Gemini API calls with retry logic and API key checks.
 * @param apiCall The actual function that performs the Gemini API call, receiving a GoogleGenAI instance.
 * @param serviceName A descriptive name for the API call (e.g., "story generation").
 * @param retryOptions Configuration for retries (maxRetries, initialDelayMs, onRetryWait callback).
 * @returns A promise that resolves to the result of the API call.
 */
async function callGeminiApiWithRetries<T>(
  apiCall: (ai: GoogleGenAI) => Promise<T>,
  serviceName: string,
  retryOptions: RetryOptions
): Promise<T> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Chave de API não configurada ou selecionada. Por favor, verifique suas variáveis de ambiente ou selecione uma chave através da interface.");
  }

  let retriesLeft = retryOptions.maxRetries;
  let delay = retryOptions.initialDelayMs;

  while (true) { // Loop indefinitely until success or a non-retryable error/max retries is reached
    try {
      // Create a new GoogleGenAI instance right before making an API call
      // to ensure it always uses the most up-to-date API key.
      const ai = new GoogleGenAI({ apiKey: apiKey });
      return await apiCall(ai); // Execute the actual API call
    } catch (error) {
      const { errorMessage, errorCode, statusMessage, retryDelayMs } = parseGeminiError(error);
      console.error(`Error during ${serviceName}:`, error);

      const isQuotaError = (errorCode === 429 || statusMessage === "RESOURCE_EXHAUSTED" || errorMessage.includes("You exceeded your current quota"));
      const isModelOverloadedError = (errorCode === 503 || statusMessage === "UNAVAILABLE" || errorMessage.includes("The model is overloaded") || errorMessage.includes("Ocorreu um erro interno nos servidores do Gemini.")); // Include our translated internal error for retry logic
      const isEmptyResponseError = errorMessage.includes("empty audio response") || errorMessage.includes("empty response from the Gemini API"); // NEW: Add condition for empty responses
      const isNotFoundKeyError = errorMessage.includes("Requested entity was not found.");

      // Special handling for 429 with explicit retryDelayMs: Re-throw immediately for caller to manage long cooldown
      if (isQuotaError && retryDelayMs !== undefined) {
          throw error; // Re-throw original error object for `StoryGeneratorApp` to parse and handle cooldown
      }

      // For other retryable errors (503, 429 without explicit retryDelayMs, or empty responses)
      if (isModelOverloadedError || (isQuotaError && retryDelayMs === undefined) || isEmptyResponseError) { // NEW: Include isEmptyResponseError here
        if (retriesLeft > 0) {
          const currentDelay = retryDelayMs !== undefined ? retryDelayMs : delay; // retryDelayMs here would only be for a 503 if any, not a 429 with specific delay
          const errorType = isQuotaError ? "Cota excedida (429, sem delay explícito)" : isEmptyResponseError ? "Resposta vazia da API" : "Modelo sobrecarregado (503) ou erro interno do servidor"; // NEW: Update errorType message
          console.warn(`${errorType} para ${serviceName}. Tentando novamente em ${currentDelay / 1000} segundos... Retries restantes: ${retriesLeft}`);
          
          // Call the onRetryWait callback if provided
          if (retryOptions.onRetryWait) {
            retryOptions.onRetryWait(currentDelay, retriesLeft, errorMessage);
          }

          await new Promise(res => setTimeout(res, currentDelay));
          if (retryDelayMs === undefined) { // Only exponential backoff if no specific delay provided by API
            delay *= 2;
          }
          retriesLeft--;
          continue; // Retry the loop
        } else {
          // Max retries exhausted for these types of errors
          if (isQuotaError) {
            // Check if the error message already contains the billing URL to avoid duplication
            if (errorMessage.includes("https://ai.google.dev/gemini-api/docs/rate-limits")) {
              throw new Error(errorMessage);
            } else {
              throw new Error(`Sua cota de API para ${serviceName} foi excedida e o número máximo de tentativas foi atingido. Por favor, verifique seus detalhes de plano e faturamento ou tente novamente mais tarde. Mais informações: https://ai.google.dev/gemini-api/docs/rate-limits (Original: ${errorMessage})`);
            }
          } else if (isModelOverloadedError) {
            throw new Error(`O serviço Gemini para ${serviceName} está temporariamente indisponível ou sobrecarregado, e o número máximo de tentativas foi excedido. Por favor, tente novamente mais tarde.`);
          } else if (isEmptyResponseError) { // NEW: Specific error for empty responses after retries
            throw new Error(`A API do Gemini retornou uma resposta vazia para ${serviceName} após múltiplas tentativas. Por favor, tente novamente mais tarde ou ajuste o prompt. (Original: ${errorMessage})`);
          } else {
            throw new Error(`Falha persistente na operação ${serviceName} após múltiplas tentativas: ${errorMessage}`);
          }
        }
      }

      // Re-throw other types of errors that are not handled by retries
      if (errorMessage.includes("403 Forbidden")) {
         throw new Error("Erro de autenticação: Por favor, verifique se sua chave de API é válida e tem acesso ao Gemini API.");
      } else if (isNotFoundKeyError) {
         // Special handling for "Requested entity was not found." - could be invalid key, or for Veo, a billing issue
         throw new Error(errorMessage); // Re-throw original message for components to handle specific key re-selection logic
      }
      // Specific error for Imagen API billing/permission, which ImageGeneratorApp will still handle for window.aistudio prompts
      if (serviceName === "image generation" && errorMessage.includes("Imagen API is only accessible to billed users at this time.")) {
        throw new Error(errorMessage); // Re-throw this specific message so ImageGeneratorApp can present the billing link
      }

      throw new Error(`Falha durante ${serviceName}: ${errorMessage}`);
    }
  }
}

/**
 * Encapsulates interactions with the Gemini API for various AI tasks.
 */
export const geminiService = {
  /**
   * Generates a chunk of story text based on a title and optional previous story context.
   * @param title The title of the story or a brief descriptor.
   * @param previousStory The accumulated story text, if continuing.
   * @param isConcludingChunk A boolean indicating if this chunk should conclude the story.
   * @param languageCode The desired language code for the story generation (e.g., 'pt', 'en').
   * @param tone The desired tone for the story (e.g., 'Tom Gospel', 'Tom Infantil', 'Neutro').
   * @param leadText An optional introductory text to guide the start of the story.
   * @param retryOptions Configuration for retries (maxRetries, initialDelayMs, onRetryWait callback).
   * @returns A promise that resolves to the generated story chunk text.
   */
  generateStoryChunk: async (
    title: string,
    previousStory: string = '',
    isConcludingChunk: boolean = false,
    languageCode: string = 'pt',
    tone: string = 'Neutro',
    leadText: string = '', // NEW: Added leadText parameter
    retryOptions: RetryOptions = { maxRetries: 3, initialDelayMs: 1000 }
  ): Promise<string> => {
    return callGeminiApiWithRetries(async (ai: GoogleGenAI) => {
      const languageName = languageMap[languageCode] || 'Português'; // Fallback to Portuguese if not found
      let prompt: string;
      const languageInstruction = `Escreva toda a resposta em ${languageName}.`;
      const toneInstruction = tone === 'Neutro' ? '' : `Seu estilo de escrita deve seguir o ${tone}.`; // NEW: Tone instruction

      // Extract the last 200 words for context to ensure smooth continuation
      const previousWords = previousStory.split(/\s+/g).filter(word => word.length > 0);
      const lastContextWords = previousWords.slice(Math.max(previousWords.length - 200, 0)).join(' ');

      let systemInstruction = `Você é um contador de histórias criativo e profissional. Suas respostas devem ser estritamente narrativas, começando imediatamente com a história. Nunca inclua introduções, saudações, frases como "Aqui está a história:", "Claro que sim!", "A História:", ou títulos/subtítulos de markdown como '# Título', '### Título', ou decoradores como '***'. O foco é em criar narrativas envolventes e coerentes com um gancho inicial forte. Garanta transições suaves entre segmentos. ${languageInstruction} ${toneInstruction}`; // NEW: Added toneInstruction

      if (isConcludingChunk) {
        // Prompt for an intriguing cliffhanger ending
        prompt = `Continue a história intitulada '${title}' (ou com o tema: ${title}). A história até agora termina com: "${lastContextWords}". Por favor, escreva um segmento final que conclua a narrativa de forma satisfatória E, crucialmente, com um desfecho intrigante, um cliffhanger inesperado que deixe o leitor ansioso pela próxima cena ou continuação. O desfecho deve ser um ponto alto, com uma revelação surpreendente ou uma pergunta sem resposta que motive o leitor a querer saber "o que acontece a seguir". Comece imediatamente com a continuação da narrativa final.`;
      } else if (previousStory) {
        // Fix: Corrected typo 'CHUNK_WORD_WORD_COUNT_TARGET' to 'CHUNK_WORD_COUNT_TARGET'
        prompt = `Continue a história intitulada '${title}' (ou com o tema: ${title}). A história até agora termina com: "${lastContextWords}". Por favor, continue a partir deste ponto, adicionando um novo segmento de aproximadamente ${CHUNK_WORD_COUNT_TARGET} palavras, desenvolvendo a trama e aprofundando os personagens. Comece imediatamente com a continuação da narrativa.`;
      } else {
        // Fix: Corrected typo 'CHUNK_WORD_WORD_COUNT_TARGET' to 'CHUNK_WORD_COUNT_TARGET'
        const initialLead = leadText.trim() ? `${leadText.trim()} ` : ''; // NEW: Incorporate leadText
        prompt = `${initialLead}Com base no título ou tema '${title}', inicie uma história cativante. Comece imediatamente com um gancho poderoso que prenda a atenção do leitor, utilizando gatilhos mentais relevantes ao tema. Desenvolva o cenário, apresente os personagens principais e comece a construir a tensão rumo ao evento dramático. O segmento deve ter aproximadamente ${CHUNK_WORD_COUNT_TARGET} palavras.`;
      }

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-pro-preview', // Changed to gemini-3-pro-preview
        contents: {
          parts: [{ text: prompt }]
        },
        config: {
          systemInstruction: systemInstruction,
          maxOutputTokens: MAX_OUTPUT_TOKENS_PER_CHUNK,
          temperature: 0.9,
          topP: 0.95,
          topK: 64,
          // thinkingConfig: { thinkingBudget: 32768 }, // Removed: thinkingConfig not supported by gemini-3-pro-preview
        },
      });

      const text = response.text;
      if (!text) {
        // Enhanced error logging and message for empty text
        console.error("Gemini API returned an empty text response. Full response:", JSON.stringify(response, null, 2));
        let additionalInfo = '';
        if (response.candidates && response.candidates.length > 0) {
          const candidate = response.candidates[0];
          if (candidate.finishReason) {
              additionalInfo += `Finish Reason: ${candidate.finishReason}. `;
          }
          if (candidate.safetyRatings && candidate.safetyRatings.length > 0) {
              const blockedCategories = candidate.safetyRatings.filter(sr => sr.blocked).map(sr => sr.category).join(', ');
              if (blockedCategories) {
                additionalInfo += `Content blocked due to safety concerns in categories: ${blockedCategories}. `;
              }
          }
        } else if (response.promptFeedback) {
          if (response.promptFeedback.blockReason) {
              additionalInfo += `Prompt Blocked: ${response.promptFeedback.blockReason}. `;
          }
          if (response.promptFeedback.safetyRatings && response.promptFeedback.safetyRatings.length > 0) {
              const blockedCategories = response.promptFeedback.safetyRatings.filter(sr => sr.blocked).map(sr => sr.category).join(', ');
              if (blockedCategories) {
                additionalInfo += `Prompt blocked due to safety concerns in categories: ${blockedCategories}. `;
              }
          }
        }
        throw new Error(`Received an empty response from the Gemini API. ${additionalInfo.trim() || 'No additional details provided by the API.'}`);
      }
      return text;
    }, "story generation", retryOptions);
  },

  /**
   * Generates speech audio from text using the Gemini TTS model.
   * @param text The text to convert to speech.
   * @param voiceName The name of the voice to use (e.g., 'Zephyr', 'Kore').
   * @param retryOptions Configuration for retries (maxRetries, initialDelayMs, onRetryWait callback).
   * @returns A promise that resolves to an AudioBuffer containing the generated speech.
   */
  generateSpeech: async (
    text: string,
    voiceName: string, // Changed from default 'Kore' to required parameter
    retryOptions: RetryOptions = { maxRetries: 3, initialDelayMs: 1000 }
  ): Promise<AudioBuffer> => {
    return callGeminiApiWithRetries(async (ai: GoogleGenAI) => {
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text: text }] }],
        config: {
          responseModalities: [Modality.AUDIO], // Must be an array with a single `Modality.AUDIO` element.
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!base64Audio) {
        // Enhanced error logging and message for empty audio
        console.error("Gemini TTS API returned an empty audio response. Full response:", JSON.stringify(response, null, 2));
        let additionalInfo = '';
        if (response.candidates && response.candidates.length > 0) {
          const candidate = response.candidates[0];
          if (candidate.finishReason) {
              additionalInfo += `Finish Reason: ${candidate.finishReason}. `;
          }
          if (candidate.safetyRatings && candidate.safetyRatings.length > 0) {
              const blockedCategories = candidate.safetyRatings.filter(sr => sr.blocked).map(sr => sr.category).join(', ');
              if (blockedCategories) {
                additionalInfo += `Content blocked due to safety concerns in categories: ${blockedCategories}. `;
              }
          }
        } else if (response.promptFeedback) {
          if (response.promptFeedback.blockReason) {
              additionalInfo += `Prompt Blocked: ${response.promptFeedback.blockReason}. `;
          }
          if (response.promptFeedback.safetyRatings && response.promptFeedback.safetyRatings.length > 0) {
              const blockedCategories = response.promptFeedback.safetyRatings.filter(sr => sr.blocked).map(sr => sr.category).join(', ');
              if (blockedCategories) {
                additionalInfo += `Prompt blocked due to safety concerns in categories: ${blockedCategories}. `;
              }
          }
        }
        throw new Error(`Received an empty audio response from the Gemini TTS API. ${additionalInfo.trim() || 'No additional details provided by the API.'}`);
      }

      // We need a dummy AudioContext here just to decode the buffer.
      // The actual playback context will be managed by the component.
      const dummyAudioContext = new AudioContext({ sampleRate: 24000 });
      const audioBuffer = await decodeAudioData(
        decode(base64Audio),
        dummyAudioContext,
        24000, // sampleRate
        1,     // numChannels
      );
      dummyAudioContext.close(); // Close the dummy context immediately after decoding

      return audioBuffer;
    }, "speech generation", retryOptions);
  },

  /**
   * Generates an image using the Imagen API.
   * @param prompt The text prompt for image generation.
   * @param aspectRatio The desired aspect ratio for the image.
   * @param retryOptions Configuration for retries (maxRetries, initialDelayMs).
   * @returns A promise that resolves to a base64 encoded image URL.
   */
  generateImage: async (
    prompt: string,
    aspectRatio: '1:1' | '16:9' | '9:16' = '1:1', // Default aspect ratio
    retryOptions: RetryOptions = { maxRetries: 3, initialDelayMs: 1000 }
  ): Promise<string> => {
    return callGeminiApiWithRetries(async (ai: GoogleGenAI) => {
      const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/png',
          aspectRatio: aspectRatio,
        },
      });

      const base64ImageBytes: string | undefined = response.generatedImages?.[0]?.image?.imageBytes;
      if (!base64ImageBytes) {
        throw new Error("Nenhum dado de imagem foi recebido do modelo.");
      }
      return `data:image/png;base64,${base64ImageBytes}`;
    }, "image generation", retryOptions);
  },

  /**
   * Generates a list of creative titles based on a model title.
   * @param modelTitle The sample title to base new titles on.
   * @param count The number of titles to generate (1-10).
   * @param languageCode The desired language for the titles.
   * @param retryOptions Configuration for retries (maxRetries, initialDelayMs).
   * @returns A promise that resolves to an array of generated titles.
   */
  generateTitles: async (
    modelTitle: string,
    count: number,
    languageCode: string = 'pt',
    retryOptions: RetryOptions = { maxRetries: 3, initialDelayMs: 1000 }
  ): Promise<string[]> => {
    return callGeminiApiWithRetries(async (ai: GoogleGenAI) => {
      const languageName = languageMap[languageCode] || 'Português';

      if (count < 1 || count > 10) {
        throw new Error("Number of titles must be between 1 and 10.");
      }

      const titleSchema: FunctionDeclaration['parameters'] = {
        type: Type.OBJECT,
        properties: {
          titles: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
              description: 'A creative title for a story or project.',
            },
            description: `An array of ${count} creative titles.`,
          },
        },
        required: ['titles'],
      };

      const prompt = `Gere ${count} títulos criativos e cativantes em ${languageName}, relacionados ou inspirados no seguinte título: "${modelTitle}". Os títulos devem ser variados em estilo e tom.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash', // Basic text model for title generation
        contents: { parts: [{ text: prompt }] },
        config: {
          temperature: 0.9,
          topP: 0.95,
          responseMimeType: "application/json",
          responseSchema: titleSchema,
        },
      });

      let jsonStr = response.text.trim();
      // Added robust parsing to handle cases where the model might wrap JSON in markdown or other text
      if (jsonStr.startsWith('```json') && jsonStr.endsWith('```')) {
        jsonStr = jsonStr.substring(7, jsonStr.length - 3).trim();
      }
      const result = JSON.parse(jsonStr);

      if (!result || !Array.isArray(result.titles) || result.titles.length === 0) {
        throw new Error("Received an invalid or empty titles response from the Gemini API.");
      }
      return result.titles.map((t: string) => sanitizeStoryText(t)); // Sanitize generated titles
    }, "title generation", retryOptions);
  },

  /**
   * NEW: Generates a list of highly dramatic and intriguing story titles based on an input image.
   * @param base64ImageData The base64 encoded string of the image.
   * @param mimeType The MIME type of the image (e.g., 'image/png', 'image/jpeg').
   * @param count The number of titles to generate (5-10).
   * @param languageCode The desired language for the titles.
   * @param retryOptions Configuration for retries (maxRetries, initialDelayMs).
   * @returns A promise that resolves to an array of generated titles.
   */
  generateTitlesFromImage: async (
    base64ImageData: string,
    mimeType: string,
    count: number,
    languageCode: string = 'pt',
    retryOptions: RetryOptions = { maxRetries: 3, initialDelayMs: 1000 }
  ): Promise<string[]> => {
    return callGeminiApiWithRetries(async (ai: GoogleGenAI) => {
      const languageName = languageMap[languageCode] || 'Português';

      if (count < 5 || count > 10) {
        throw new Error("Number of titles must be between 5 and 10.");
      }

      // REMOVED: responseSchema and responseMimeType as gemini-2.5-flash-image does not support JSON mode directly.
      // The prompt will instruct the model to output JSON text.

      const prompt = `Analyze the provided image in detail. Based on the visual content, generate between ${count} and ${count} highly dramatic and intriguing story titles. Each title MUST be between 95 and 99 characters long (inclusive). The titles should follow this semantic structure and style, characteristic of human-interest, unexpected-turn stories:
      - Focus on a specific individual or small group (e.g., "Viúva", "Casal de Idosos", "Filho", "Mãe").
      - Introduce an initial situation, often challenging or mundane (e.g., "Heredou Uma Casa Antiga", "Foi Morar No Farol Abandonado", "Abandonou A Mãe Numa Ilha Deserta").
      - Crucially, introduce a turning point or unexpected discovery using an em dash " — " to separate it from the initial situation (e.g., " — E Descobriu Um Tesouro Oculto", " — E O Mar Revelou O Que Ninguém Imaginava", " — E O Que Viu O Deixou Sem Palavras").
      - Use strong, evocative language to create intrigue and a sense of mystery or surprise.
      - Examples of style to follow:
          - "Viúva De 79 Anos Heredou Uma Casa Antiga De 1973 — E Descobriu Um Tesouro Oculto Em Uma Velha Maleta"
          - "Filho Abandonou A Mãe Numa Ilha Deserta — Anos Depois Voltou E O Que Viu O Deixou Sem Palavras"
          - "Mãe Abandonada Grávida Comprou Barraco Por 100 Reais — E O Que Encontrou Lá Ninguém Imaginava..."

      The titles must be in ${languageName}. Return the output as a JSON array of strings, enclosed in a markdown code block like \`\`\`json["title1", "title2", ...]\`\`\`.`;

      // NEW: Add a system instruction to explicitly guide the model's role and output format.
      const systemInstruction = `Você é um gerador de títulos criativos e dramáticos, especializado em criar títulos no estilo de histórias de "choque e admiração" sobre reviravoltas na vida, tesouros escondidos ou destinos inesperados. Sua única tarefa é analisar a imagem fornecida e gerar os títulos solicitados em formato JSON. Não inclua nenhuma outra informação ou formatação além do array JSON. Responda estritamente em ${languageName}.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image', // Multimodal model for image input
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64ImageData,
              },
            },
            { text: prompt },
          ],
        },
        config: {
          systemInstruction: systemInstruction, // Add system instruction here
          temperature: 0.9,
          topP: 0.95,
          topK: 64,
          // thinkingConfig is not supported by gemini-2.5-flash-image, so it's omitted
          // REMOVED: thinkingConfig: { thinkingBudget: 256 },
          // REMOVED: responseMimeType: "application/json",
          // REMOVED: responseSchema: titleSchema,
        },
      });

      let jsonStr = response.text.trim();
      if (jsonStr.startsWith('```json') && jsonStr.endsWith('```')) {
        jsonStr = jsonStr.substring(7, jsonStr.length - 3).trim();
      } else {
        console.warn("JSON response for titles was not wrapped in markdown block as expected. Attempting direct parse.");
        // If not wrapped, try to find the first and last brackets for more robust parsing
        const firstBracket = jsonStr.indexOf('[');
        const lastBracket = jsonStr.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
          jsonStr = jsonStr.substring(firstBracket, lastBracket + 1);
          console.warn("Trimmed JSON string based on bracket detection.");
        } else {
          console.error("Could not find valid JSON array structure in response.");
        }
      }

      try {
        const result = JSON.parse(jsonStr);
        if (!result || !Array.isArray(result) || result.length === 0) { // Expecting direct array
          throw new Error("Received an invalid or empty titles array from the Gemini API.");
        }
        if (result.length !== count) {
            console.warn(`Gemini returned ${result.length} titles, but ${count} were requested.`);
        }
        return result.map((t: string) => sanitizeStoryText(t)); // Sanitize generated titles
      } catch (parseError) {
         console.error("Failed to parse JSON response for titles:", parseError, "Raw response:", jsonStr);
         throw new Error(`Falha ao analisar a resposta JSON para títulos. Resposta bruta: "${jsonStr.substring(0, Math.min(jsonStr.length, 200))}..."`);
      }
    }, "image-based title generation", retryOptions);
  },

  /**
   * Generates a detailed image prompt or multiple scene prompts based on an input image, desired language, and image type.
   * @param base64ImageData The base64 encoded string of the image. (Optional)
   * @param mimeType The MIME type of the image (e.g., 'image/png', 'image/jpeg'). (Optional)
   * @param languageCode The desired language code for the generated prompt (e.g., 'en', 'pt').
   * @param imageType The desired style/type for the image (e.g., 'Realistic Full HD').
   * @param numPrompts The number of prompts to generate (default 1).
   * @param textInputPrompt An optional text string to describe the idea or object.
   * @param characters An optional array of character descriptions.
   * @param action An optional action description.
   * @param retryOptions Configuration for retries.
   * @returns A promise that resolves to a string (single prompt) or an array of strings (multiple prompts).
   */
  generateImagePrompt: async (
    base64ImageData: string | null = null, // Made optional, default to null
    mimeType: string | null = null,       // Made optional, default to null
    languageCode: string = 'en',
    imageType: string = 'Realistic Full HD', // e.g., "Realistic Full HD", "Watercolor Painting"
    numPrompts: number = 1, // NEW: default to 1 for backward compatibility/single prompt
    textInputPrompt: string = '',         // NEW: Added optional text input
    characters?: string[], // NEW: Optional array of character descriptions
    action?: string,       // NEW: Optional action description
    retryOptions: RetryOptions = { maxRetries: 3, initialDelayMs: 1000 }
  ): Promise<string | string[]> => { // Return type can be string or string[]
    return callGeminiApiWithRetries(async (ai: GoogleGenAI) => {
      const languageName = languageMap[languageCode] || 'English';
      const hasImage = !!base64ImageData && !!mimeType;
      const hasTextInput = !!textInputPrompt.trim();
      const hasCharacters = characters && characters.filter(c => c.trim()).length > 0;
      const hasAction = !!action?.trim();

      if (!hasImage && !hasTextInput && !hasCharacters && !hasAction) {
        throw new Error("Por favor, carregue uma imagem OU insira um texto para gerar o prompt. Ou descreva personagens e ação.");
      }
      if (numPrompts < 1 || numPrompts > 10) {
        throw new Error("O número de prompts deve ser entre 1 e 10.");
      }

      let modelToUse: string;
      const contentsParts: any[] = [];
      let systemInstruction = `Você é um especialista em criação de prompts para geração de imagens de IA. Suas respostas devem ser descrições detalhadas e prontas para uso em modelos de IA. Nunca inclua introduções, saudações, ou frases como "Aqui está o prompt:", "Claro que sim!". Responda em ${languageName}.`;
      let userPromptContent: string;

      // Determine the core textual input for the prompt
      let coreTextualInput = '';
      if (hasCharacters || hasAction) {
        coreTextualInput += hasCharacters ? `Personagens: ${characters!.filter(c => c.trim()).join(', ')}. ` : '';
        coreTextualInput += hasAction ? `Ação: ${action}. ` : '';
        // If characters/action are provided, prioritize them over general textInputPrompt
      } else if (hasTextInput) {
        coreTextualInput = textInputPrompt;
      }
      
      // Construct the main user prompt
      if (hasImage) {
        modelToUse = 'gemini-2.5-flash-image';
        contentsParts.push({
          inlineData: {
            mimeType: mimeType!,
            data: base64ImageData!,
          },
        });
        userPromptContent = `Analise a imagem fornecida. Use-a para enriquecer detalhes visuais, estilo e ambiente. Baseie o conteúdo da cena na seguinte ideia: "${coreTextualInput}". Gere ${numPrompts} prompts distintos para um modelo de geração de imagens de IA, com foco em um estilo "${imageType}". Cada prompt deve ser extremamente detalhado, cobrindo assunto, ambiente, iluminação, cores, texturas, ângulo de câmera, composição e humor.`;
      } else { // Only text or characters/action, no image
        modelToUse = 'gemini-2.5-flash'; // Use text-only model
        userPromptContent = `Com base na seguinte ideia: "${coreTextualInput}", gere ${numPrompts} prompts distintos para um modelo de geração de imagens de IA, com foco em um estilo "${imageType}". Cada prompt deve ser extremamente detalhado, cobrindo assunto, ambiente, iluminação, cores, texturas, ângulo de câmera, composição e humor.`;
      }

      // If multiple prompts are requested, instruct the model to return a JSON array in markdown.
      if (numPrompts > 1) {
        userPromptContent += ` Retorne a saída como um array JSON de strings, envolvido em um bloco de código markdown como \`\`\`json["prompt1", "prompt2", ...]\`\`\`.`;
      }

      // Add the combined user prompt to contents
      contentsParts.push({ text: userPromptContent });

      // Config object for generateContent - removed responseMimeType and responseSchema
      const config: any = {
        temperature: 0.8,
        topP: 0.9,
        topK: 40,
        systemInstruction: systemInstruction,
      };

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: { parts: contentsParts },
        config: config, // Use the modified config without responseMimeType/responseSchema
      });

      if (numPrompts > 1) {
        let jsonStr = response.text.trim();
        // Extract JSON from markdown code block if present
        if (jsonStr.startsWith('```json') && jsonStr.endsWith('```')) {
          jsonStr = jsonStr.substring(7, jsonStr.length - 3).trim();
        } else {
          // If not wrapped in markdown, try to parse directly, but log a warning
          console.warn("JSON response for multiple prompts was not wrapped in markdown block as expected. Attempting direct parse.");
        }
        try {
          const result = JSON.parse(jsonStr);
          if (!result || !Array.isArray(result) || result.length === 0) { // Changed to expect a direct array, not { prompts: [] }
            throw new Error("Received an invalid or empty prompts array from the Gemini API.");
          }
          // Ensure the number of prompts matches the request (or at least some are returned)
          if (result.length !== numPrompts) {
              console.warn(`Gemini returned ${result.length} prompts, but ${numPrompts} were requested.`);
          }
          return result.map((p: string) => sanitizeStoryText(p));
        } catch (parseError) {
           console.error("Failed to parse JSON response for multiple prompts:", parseError, "Raw response:", jsonStr);
           throw new Error(`Falha ao analisar a resposta JSON para múltiplos prompts. Resposta bruta: "${jsonStr.substring(0, Math.min(jsonStr.length, 200))}..."`);
        }
      } else {
        const detailedPrompt = response.text.trim();
        if (!detailedPrompt) {
          console.error("Gemini API returned an empty text response. Full response:", JSON.stringify(response, null, 2));
          let additionalInfo = '';
          if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            if (candidate.finishReason) {
                additionalInfo += `Finish Reason: ${candidate.finishReason}. `;
            }
            if (candidate.safetyRatings && candidate.safetyRatings.length > 0) {
                const blockedCategories = candidate.safetyRatings.filter(sr => sr.blocked).map(sr => sr.category).join(', ');
                if (blockedCategories) {
                  additionalInfo += `Content blocked due to safety concerns in categories: ${blockedCategories}. `;
                }
            }
          } else if (response.promptFeedback) {
            if (response.promptFeedback.blockReason) {
                additionalInfo += `Prompt Blocked: ${response.promptFeedback.blockReason}. `;
            }
            if (response.promptFeedback.safetyRatings && response.promptFeedback.safetyRatings.length > 0) {
                const blockedCategories = response.promptFeedback.safetyRatings.filter(sr => sr.blocked).map(sr => sr.category).join(', ');
                if (blockedCategories) {
                  additionalInfo += `Prompt blocked due to safety concerns in categories: ${blockedCategories}. `;
                }
            }
          }
          throw new Error(`Received an empty prompt response from the Gemini API. ${additionalInfo.trim() || 'No additional details provided by the API.'}`);
        }
        return sanitizeStoryText(detailedPrompt);
      }
    }, "image prompt generation", retryOptions);
  },

  /**
   * Reduces the length of a given text to approximately a target character count while preserving its core meaning.
   * @param text The original text to be reduced.
   * @param targetLength The desired maximum character length for the reduced text.
   * @param languageCode The desired language code for the output.
   * @param retryOptions Configuration for retries.
   * @returns A promise that resolves to the reduced text.
   */
  reduceText: async (
    text: string,
    targetLength: number,
    languageCode: string = 'pt',
    retryOptions: RetryOptions = { maxRetries: 3, initialDelayMs: 1000 }
  ): Promise<string> => {
    return callGeminiApiWithRetries(async (ai: GoogleGenAI) => {
      const languageName = languageMap[languageCode] || 'Português'; // Fallback to Portuguese

      if (targetLength <= 0) {
        throw new Error("O número de caracteres alvo deve ser um valor positivo.");
      }

      const prompt = `Rewrite the following text in ${languageName}, making it as concise as possible while fully preserving its core meaning. The rewritten text should ideally be no more than ${targetLength} characters long. Prioritize retaining essential information and clarity.
      
      Original text: "${text}"`;

      // Estimate maxOutputTokens based on targetLength
      // Assuming 1 token ~ 4 characters, add a buffer to allow some model 'thinking' or slight overshoot.
      const estimatedMaxTokens = Math.ceil(targetLength * 1.5 / 4); // x1.5 buffer for token-char variability
      const finalMaxOutputTokens = Math.min(MAX_OUTPUT_TOKENS_PER_CHUNK, Math.max(50, estimatedMaxTokens)); // Min 50 tokens, max StoryGenerator's chunk limit

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash', // Suitable for text summarization/reduction
        contents: {
          parts: [{ text: prompt }]
        },
        config: {
          systemInstruction: `Você é um assistente de reescrita de texto profissional e conciso. Seu objetivo é resumir o texto fornecido mantendo todo o seu significado original, sem adicionar informações novas. A resposta deve ser estritamente o texto reescrito, sem introduções ou comentários. Responda em ${languageName}.`,
          maxOutputTokens: finalMaxOutputTokens,
          temperature: 0.7, // Slightly lower temperature for more focused output
          topP: 0.9,
          topK: 40,
          thinkingConfig: { thinkingBudget: 100 }, // Allocate some thinking budget
        },
      });

      const reducedText = response.text;
      if (!reducedText) {
        console.error("Gemini API returned an empty text response for reduction. Full response:", JSON.stringify(response, null, 2));
        let additionalInfo = '';
        if (response.candidates && response.candidates.length > 0) {
          const candidate = response.candidates[0];
          if (candidate.finishReason) {
              additionalInfo += `Finish Reason: ${candidate.finishReason}. `;
          }
          if (candidate.safetyRatings && response.safetyRatings.length > 0) {
              const blockedCategories = candidate.safetyRatings.filter(sr => sr.blocked).map(sr => sr.category).join(', ');
              if (blockedCategories) {
                additionalInfo += `Content blocked due to safety concerns in categories: ${blockedCategories}. `;
              }
          }
        } else if (response.promptFeedback) {
          if (response.promptFeedback.blockReason) {
              additionalInfo += `Prompt Blocked: ${response.promptFeedback.blockReason}. `;
          }
          if (response.promptFeedback.safetyRatings && response.promptFeedback.safetyRatings.length > 0) {
              const blockedCategories = response.promptFeedback.safetyRatings.filter(sr => sr.blocked).map(sr => sr.category).join(', ');
              if (blockedCategories) {
                additionalInfo += `Prompt blocked due to safety concerns in categories: ${blockedCategories}. `;
              }
          }
        }
        throw new Error(`Received an empty response from the Gemini API when trying to reduce text. ${additionalInfo.trim() || 'No additional details provided by the API.'}`);
      }
      return sanitizeStoryText(reducedText); // Sanitize the output
    }, "text reduction", retryOptions);
  },

  /**
   * Generates a video from a static image, with optional movement prompt.
   * @param base64ImageData The base64 encoded string of the image.
   * @param mimeType The MIME type of the image (e.g., 'image/png', 'image/jpeg').
   * @param prompt An optional text prompt to guide the video movement/content.
   * @param onPollingUpdate Callback to report polling progress/messages.
   * @param retryOptions Configuration for retries.
   * @returns A promise that resolves to the_direct download URL of the generated video (MP4).
   */
  generateVideoFromImage: async (
    base64ImageData: string,
    mimeType: string,
    prompt: string = '',
    onPollingUpdate: (message: string) => void,
    retryOptions: RetryOptions = { maxRetries: 3, initialDelayMs: 5000 } // Increased initial delay for video
  ): Promise<string> => {
    return callGeminiApiWithRetries(async (ai: GoogleGenAI) => {
      onPollingUpdate("Iniciando a geração do vídeo...");
      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview', // Or 'veo-3.1-generate-preview' for higher quality
        prompt: prompt, // Optional prompt for movement
        image: {
          imageBytes: base64ImageData,
          mimeType: mimeType,
        },
        config: {
          numberOfVideos: 1,
          resolution: '720p', // Can be 720p or 1080p
          aspectRatio: '16:9', // Can be 16:9 or 9:16
        },
      });

      let pollingAttempts = 0;
      const MAX_POLLING_ATTEMPTS = 60; // Max 60 attempts * 10s = 10 minutes timeout
      const POLLING_INTERVAL_MS = 10000; // Poll every 10 seconds

      while (!operation.done && pollingAttempts < MAX_POLLING_ATTEMPTS) {
        onPollingUpdate(`Gerando vídeo (Aguarde, pode levar alguns minutos - ${pollingAttempts + 1}/${MAX_POLLING_ATTEMPTS} verificações)...`);
        await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
        operation = await ai.operations.getVideosOperation({ operation: operation });
        pollingAttempts++;
      }

      if (!operation.done) {
        throw new Error("A geração do vídeo excedeu o tempo limite.");
      }
      if (!operation.response?.generatedVideos?.[0]?.video?.uri) {
        throw new Error("Nenhum URL de vídeo foi retornado após a geração.");
      }

      const downloadLink = operation.response.generatedVideos[0].video.uri;
      // The response.body contains the MP4 bytes. You must append an API key when fetching from the download link.
      // The `callGeminiApiWithRetries` already injects the API_KEY into `process.env.API_KEY`,
      // but for direct fetch from the URI, it needs to be explicitly added.
      const finalVideoUrl = `${downloadLink}&key=${process.env.API_KEY}`;
      onPollingUpdate("Vídeo gerado com sucesso!");
      return finalVideoUrl;
    }, "video generation from image", retryOptions);
  },

  /**
   * NEW: Generates a chunk of story text based on an input image and optional previous story context.
   * @param base64ImageData The base64 encoded string of the image.
   * @param mimeType The MIME type of the image (e.g., 'image/png', 'image/jpeg').
   * @param previousStory The accumulated story text, if continuing.
   * @param isConcludingChunk A boolean indicating if this chunk should conclude the story.
   * @param languageCode The desired language code for the story generation (e.g., 'pt', 'en').
   * @param tone The desired tone for the story (e.g., 'Tom Gospel', 'Tom Infantil', 'Neutro').
   * @param leadText An optional introductory text to guide the start of the story.
   * @param retryOptions Configuration for retries (maxRetries, initialDelayMs, onRetryWait callback).
   * @returns A promise that resolves to the generated story chunk text.
   */
  generateStoryFromImageChunk: async (
    base64ImageData: string,
    mimeType: string,
    previousStory: string = '',
    isConcludingChunk: boolean = false,
    languageCode: string = 'pt',
    tone: string = 'Neutro',
    leadText: string = '', // NEW: Added leadText parameter
    retryOptions: RetryOptions = { maxRetries: 3, initialDelayMs: 1000 }
  ): Promise<string> => {
    return callGeminiApiWithRetries(async (ai: GoogleGenAI) => {
      const languageName = languageMap[languageCode] || 'Português';
      let prompt: string;
      const languageInstruction = `Escreva toda a resposta em ${languageName}.`;
      const toneInstruction = tone === 'Neutro' ? '' : `Seu estilo de escrita deve seguir o ${tone}.`; // NEW: Tone instruction

      // Extract the last 200 words for context to ensure smooth continuation
      const previousWords = previousStory.split(/\s+/g).filter(word => word.length > 0);
      const lastContextWords = previousWords.slice(Math.max(previousWords.length - 200, 0)).join(' ');

      let systemInstruction = `Você é um contador de histórias criativo e profissional. Sua tarefa é criar narrativas envolventes e coerentes, inspiradas fortemente na imagem fornecida. Suas respostas devem ser estritamente narrativas, começando imediatamente com a história. Nunca inclua introduções, saudações, frases como "Aqui está a história:", "Claro que sim!", "A História:", ou títulos/subtítulos de markdown como '# Título', '### Título', ou decoradores como '***'. Garanta transições suaves entre segmentos e mantenha a coesão com os elementos visuais da imagem e o contexto narrativo. ${languageInstruction} ${toneInstruction}`; // NEW: Added toneInstruction

      const contentsParts: any[] = [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64ImageData,
          },
        },
      ];

      if (isConcludingChunk) {
        prompt = `Com base na imagem, continue a história que até agora termina com: "${lastContextWords}". Por favor, escreva um segmento final que conclua a narrativa de forma satisfatória E, crucialmente, com um desfecho intrigante, um cliffhanger inesperado que deixe o leitor ansioso. O desfecho deve ser um ponto alto, com uma revelação surpreendente ou uma pergunta sem resposta. Comece imediatamente com a continuação da narrativa final.`;
      } else if (previousStory) {
        prompt = `Com base na imagem, continue a história que até agora termina com: "${lastContextWords}". Por favor, continue a partir deste ponto, adicionando um novo segmento de aproximadamente ${CHUNK_WORD_COUNT_TARGET} palavras, desenvolvendo a trama e aprofundando os personagens, sempre mantendo a inspiração visual da imagem. Comece imediatamente com a continuação da narrativa.`;
      } else {
        // Corrected typo 'CHUNK_WORD_WORD_COUNT_TARGET' to 'CHUNK_WORD_COUNT_TARGET'
        const initialLead = leadText.trim() ? `${leadText.trim()} ` : ''; // NEW: Incorporate leadText
        prompt = `${initialLead}Analise a imagem fornecida. Inicie uma história cativante inspirada diretamente nela. Comece imediatamente com um gancho poderoso que prenda a atenção do leitor, utilizando elementos visuais da imagem para construir o cenário, apresentar personagens e a tensão. O segmento deve ter aproximadamente ${CHUNK_WORD_COUNT_TARGET} palavras.`;
      }

      contentsParts.push({ text: prompt });

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-pro-preview', // Changed to gemini-3-pro-preview
        contents: {
          parts: contentsParts
        },
        config: {
          systemInstruction: systemInstruction,
          maxOutputTokens: MAX_OUTPUT_TOKENS_PER_CHUNK,
          temperature: 0.9,
          topP: 0.95,
          topK: 64,
          // thinkingConfig is not supported by gemini-3-pro-preview, so it's omitted
        },
      });

      const text = response.text;
      if (!text) {
        console.error("Gemini API returned an empty text response for story from image. Full response:", JSON.stringify(response, null, 2));
        let additionalInfo = '';
        if (response.candidates && response.candidates.length > 0) {
          const candidate = response.candidates[0];
          if (candidate.finishReason) {
              additionalInfo += `Finish Reason: ${candidate.finishReason}. `;
          }
          if (candidate.safetyRatings && candidate.safetyRatings.length > 0) {
              const blockedCategories = candidate.safetyRatings.filter(sr => sr.blocked).map(sr => sr.category).join(', ');
              if (blockedCategories) {
                additionalInfo += `Content blocked due to safety concerns in categories: ${blockedCategories}. `;
              }
          }
        } else if (response.promptFeedback) {
          if (response.promptFeedback.blockReason) {
              additionalInfo += `Prompt Blocked: ${response.promptFeedback.blockReason}. `;
          }
          if (response.promptFeedback.safetyRatings && response.promptFeedback.safetyRatings.length > 0) {
              const blockedCategories = response.promptFeedback.safetyRatings.filter(sr => sr.blocked).map(sr => sr.category).join(', ');
              if (blockedCategories) {
                additionalInfo += `Prompt blocked due to safety concerns in categories: ${blockedCategories}. `;
              }
          }
        }
        throw new Error(`Received an empty response from the Gemini API for story from image. ${additionalInfo.trim() || 'No additional details provided by the API.'}`);
      }
      return text;
    }, "story from image generation", retryOptions);
  },
};