
export const WORDS_PER_MINUTE = 150; // Average reading speed
export const TARGET_READING_TIME_MINUTES = 60; // Changed from 50 to 60 minutes
export const CHUNK_WORD_COUNT_TARGET = 4000; // Aim for ~4000 words per chunk, ~26-27 minutes reading time
export const MAX_OUTPUT_TOKENS_PER_CHUNK = 6000; // Adjusted for ~4000 words. (4000 words * ~5 chars/word / 4 chars/token = 5000 tokens. Added buffer.)
    