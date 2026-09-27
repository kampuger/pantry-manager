export interface NameSuggestion {
  name: string;
  similarity: number;
}

// Below this similarity, a "did you mean" suggestion is more likely to be
// noise than help — e.g. two short, unrelated item names can share enough
// characters to score higher than expected by chance.
const SUGGESTION_MIN_SIMILARITY = 0.6;

function normalizeForMatch(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Standard Levenshtein (edit) distance via full dynamic-programming table —
// names here are short (a few words), so the O(n*m) cost is negligible.
function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[rows - 1][cols - 1];
}

function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

// Finds the closest match for `candidate` among `knownNames` (e.g. names
// already used in this household's pantry), for suggesting a likely-correct
// name when OCR garbles part of a scanned item — a personalized "dictionary"
// that needs no external word list and naturally covers brand/product names
// a generic dictionary never would. Returns null when nothing is close
// enough to be worth suggesting, or when the candidate already exactly
// matches a known name (nothing to suggest).
export function suggestKnownName(candidate: string, knownNames: string[]): NameSuggestion | null {
  const normalizedCandidate = normalizeForMatch(candidate);
  if (normalizedCandidate === '') return null;

  let best: NameSuggestion | null = null;
  for (const known of knownNames) {
    const normalizedKnown = normalizeForMatch(known);
    if (normalizedKnown === '' || normalizedKnown === normalizedCandidate) continue;

    const similarity = levenshteinSimilarity(normalizedCandidate, normalizedKnown);
    if (similarity >= SUGGESTION_MIN_SIMILARITY && (!best || similarity > best.similarity)) {
      best = { name: known, similarity };
    }
  }
  return best;
}
