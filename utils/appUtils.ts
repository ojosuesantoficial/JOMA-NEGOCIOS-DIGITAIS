
// utils/appUtils.ts

// Map language codes to human-readable names for UI and prompts
export const languageOptions: { code: string; name: string }[] = [
  { code: 'pt', name: 'Português' },
  { code: 'en', name: 'Inglês' },
  { code: 'es', name: 'Espanhol' },
  { code: 'fr', name: 'Francês' },
  { code: 'de', name: 'Alemão' },
  { code: 'it', name: 'Italiano' },
  { code: 'ja', name: 'Japonês' },
  { code: 'zh', name: 'Chinês (Simplificado)' },
  { code: 'ru', name: 'Russo' },
  { code: 'ar', name: 'Árabe' },
];

export const languageMap: { [key: string]: string } = languageOptions.reduce((map, lang) => {
  map[lang.code] = lang.name;
  return map;
}, {} as { [key: string]: string });

// NEW: Tone options for story generation
export const toneOptions: { value: string; label: string }[] = [
  { value: 'Neutro', label: 'Neutro' },
  { value: 'Tom Gospel', label: 'Tom Gospel' },
  { value: 'Tom Infantil', label: 'Tom Infantil' },
  { value: 'Tom Filme de Ação', label: 'Tom Filme de Ação' },
  { value: 'Tom Filme de Suspense', label: 'Tom Filme de Suspense' },
  { value: 'Tom Filme de Drama', label: 'Tom Filme de Drama' },
  { value: 'Tom Filme Serio', label: 'Tom Filme Sério' },
  { value: 'Tom Documentário', label: 'Tom Documentário' }, // NEW
];

// NEW: Map tone values to a specific voice name for previews
export const VOICE_TONE_MAP: { [toneValue: string]: string } = {
  'Neutro': 'Kore', // Clara e Equilibrada
  'Tom Gospel': 'Zephyr', // Suave e Calma
  'Tom Infantil': 'Puck', // Jovial e Expressiva
  'Tom Filme de Ação': 'Fenrir', // Ressonante e Impactante (Corrected typo 'Aação' to 'Ação')
  'Tom Filme de Suspense': 'Charon', // Profunda e Autoritária
  'Tom Filme de Drama': 'Kore', // Clara e Equilibrada, boa para alcance emocional
  'Tom Filme Serio': 'Charon', // Profunda e Autoritária, boa para tom sério
  'Tom Documentário': 'Charon', // Use a deep, authoritative voice for documentary style // NEW
};

// NEW: Background music options for audio generation
export const BACKGROUND_MUSIC_OPTIONS: { value: string; label: string; url?: string }[] = [
  { value: 'none', label: 'Nenhum' },
  // Using reliable, publicly accessible MP3 links from Internet Archive (Kevin MacLeod via Incompetech)
  // These are under Creative Commons BY 4.0 license and are generally permissive for direct linking.
  { value: 'soft_piano', label: 'Piano Suave', url: 'https://archive.org/download/Music_for_Manatees/Music_for_Manatees.mp3' },
  { value: 'epic_orchestra', label: 'Orquestra Épica', url: 'https://archive.org/download/Imperfection_201809/Imperfection.mp3' },
  { value: 'acoustic_folk', label: 'Folk Acústico', url: 'https://archive.org/download/Sunshine_A/Sunshine_A.mp3' },
];

// NEW: Default volume levels for speech and background music
export const DEFAULT_SPEECH_VOLUME = 0.8;
export const DEFAULT_MUSIC_VOLUME = 0.3;

// NEW: Text used for audio previews
export const AUDIO_PREVIEW_TEXT = "O amor é paciente, o amor é bondoso. Não inveja, não se vangloria, não é orgulhoso.";

// Helper function to calculate word count and reading time
export const calculateReadingTime = (text: string): { wordCount: number; readingTimeMinutes: number } => {
  const words = text.split(/\s+/g).filter(word => word.length > 0).length;
  // Fallback to WORDS_PER_MINUTE if it's 0 to prevent division by zero
  const readingTimeMinutes = words / (150); // Using 150 as a default if WORDS_PER_MINUTE constant isn't accessible
  return { wordCount: words, readingTimeMinutes };
};


// Helper function for general story text sanitization (applies to all chunks)
export const sanitizeStoryText = (text: string): string => {
  let sanitized = text;
  // Replace smart quotes with straight quotes
  sanitized = sanitized.replace(/[\u201C\u201D]/g, '"'); // “ ”
  sanitized = sanitized.replace(/[\u2018\u2019]/g, "'"); // ‘ ’
  // Replace guillemets (French quotes) with straight quotes
  // Fix: Corrected typo 'sanitized.20replace' to 'sanitized.replace'
  sanitized = sanitized.replace(/[\u00AB\u00BB]/g, '"'); // « »
  // Replace en dash with em dash (to standardize to the longer dash requested for titles)
  sanitized = sanitized.replace(/\u2013/g, '\u2014'); // – -> —
  // Em dash (\u2014) will now be preserved if the model generates it.
  // Replace ellipsis with three periods
  sanitized = sanitized.replace(/\u2026/g, '...'); // …
  // Remove markdown bold/italic markers, but keep the inner text (e.g., **text** -> text)
  sanitized = sanitized.replace(/\*{1,3}(.*?)\*{1,3}/g, '$1');
  sanitized = sanitized.replace(/_{1,3}(.*?)_{1,3}/g, '$1');
  // Remove hash headings (e.g., ### Title)
  sanitized = sanitized.replace(/^#{1,6}\s*(.*)$/gm, '$1');
  // Normalize multiple spaces and trim
  sanitized = sanitized.replace(/\s\s+/g, ' ').trim();
  return sanitized;
};

// Helper function to trim introductory phrases (applies only to the first chunk)
export const trimIntroductoryPhrases = (text: string, title: string): string => {
  let cleanedText = text;

  // List of common unwanted leading phrases/patterns (case-insensitive)
  const unwantedPatterns = [
    // Conversational openers
    /^["']?(Claro\.?|Ok\.?|Aqui está o início da história\.?|Aqui tienes el comienzo de la historia\.?|Here's the beginning of the story\.?|Here's your story\.?|Certainly\.?|Okey\.?|A história começa assim\.?|Vamos começar a história\.?|Comece a história\.?|Sim, aqui está a história\.?)/i,
    // Explicit story headers/labels
    /^["']?A\s+História["']?[:\.\s]*/i,
    /^["']?The\s+Story["']?[:\.\s]*/i,
    /^["']?O\s+Início["']?[:\.\s]*/i,
    // Literal triple asterisks and other leading markdown noise
    /^\s*\*\*\*\s*/,
    /^\s*["']?/, // Attempt to remove a leading quote that might enclose an unwanted phrase

    // Specific user example string if it appears verbatim, or variations of it
    // Escaping title for regex safety
    new RegExp(`^["']?${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?[:\.\s]*`, 'i'),
  ];

  for (const pattern of unwantedPatterns) {
    cleanedText = cleanedText.replace(pattern, '').trim();
  }

  // Remove any remaining leading/trailing quotes or special characters that might act as an enclosure
  cleanedText = cleanedText.replace(/^['"«\s]+|['"»\s]+$/g, '');

  // Final trim to ensure no leading/trailing whitespace remains
  return cleanedText.trim();
};
