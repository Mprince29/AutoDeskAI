import { useState, useCallback } from 'react';

export const countSyllables = (word: string) => {
  word = word.toLowerCase();
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
};

export const calculateStats = (text: string) => {
  if (!text) return { words: 0, chars: 0, sentences: 0, readability: 0, score: 0, readingTime: 0, keywords: [] as [string, number][] };
  
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const charCount = text.length;

  if (words.length === 0) return { words: 0, chars: 0, sentences: 0, readability: 0, score: 0, readingTime: 0, keywords: [] as [string, number][] };

  const syllables = words.reduce((acc, word) => acc + countSyllables(word), 0);
  const readability = 0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59;

  // Top Keywords (primitive)
  const stopWords = new Set(['the', 'and', 'a', 'to', 'of', 'in', 'is', 'it', 'that', 'with', 'for', 'on', 'was', 'as', 'are', 'be']);
  const freq: Record<string, number> = {};
  words.forEach(w => {
    const clean = w.toLowerCase().replace(/[^a-z]/g, '');
    if (clean.length > 3 && !stopWords.has(clean)) {
      freq[clean] = (freq[clean] || 0) + 1;
    }
  });

  const keywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return {
    words: words.length,
    chars: charCount,
    sentences: sentences.length,
    readability: Math.max(0, Math.min(20, Math.round(readability * 10) / 10)),
    score: Math.round(Math.max(0, Math.min(100, (words.length > 500 ? 90 : words.length > 200 ? 80 : words.length > 0 ? 70 : 0) + (10 - Math.abs(readability - 9))))),
    readingTime: Math.ceil(words.length / 200),
    keywords
  };
};

export function useArticleStats() {
  const [stats, setStats] = useState({ words: 0, readingTime: 0, score: 0 });

  const updateStats = useCallback((text: string) => {
    const newStats = calculateStats(text);
    setStats({
      words: newStats.words,
      readingTime: newStats.readingTime,
      score: newStats.score
    });
    return newStats;
  }, []);

  return { stats, updateStats };
}
