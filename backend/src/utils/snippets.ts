import { query } from '../config/database';

const SNIPPET_REGEX = /\{\{snippet:([a-zA-Z0-9_-]+)\}\}/g;

interface SnippetCache {
  [shortcut: string]: string;
}

const cache = new Map<string, { data: SnippetCache; expires: number }>();
const CACHE_TTL = 60 * 1000; // 60 seconds

async function loadWorkspaceSnippets(workspaceId: string): Promise<SnippetCache> {
  const cached = cache.get(workspaceId);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const result = await query<{ shortcut: string; content: string; content_html: string | null }>(
    'SELECT shortcut, content, content_html FROM snippets WHERE workspace_id = $1 AND shortcut IS NOT NULL',
    [workspaceId]
  );

  const data: SnippetCache = {};
  for (const row of result.rows) {
    data[row.shortcut] = row.content_html || row.content;
  }

  cache.set(workspaceId, { data, expires: Date.now() + CACHE_TTL });
  return data;
}

export async function expandSnippets(text: string, workspaceId: string): Promise<string> {
  if (!text || !text.includes('{{snippet:')) return text;

  const snippets = await loadWorkspaceSnippets(workspaceId);
  const usedShortcuts: string[] = [];

  const expanded = text.replace(SNIPPET_REGEX, (match, shortcut: string) => {
    if (snippets[shortcut]) {
      usedShortcuts.push(shortcut);
      return snippets[shortcut];
    }
    return match;
  });

  // Async fire-and-forget: increment use_count
  if (usedShortcuts.length > 0) {
    query(
      'UPDATE snippets SET use_count = use_count + 1 WHERE workspace_id = $1 AND shortcut = ANY($2::text[])',
      [workspaceId, usedShortcuts]
    ).catch((err) => console.warn('Snippet use_count update failed:', err.message));
  }

  return expanded;
}

export function invalidateSnippetCache(workspaceId: string): void {
  cache.delete(workspaceId);
}
