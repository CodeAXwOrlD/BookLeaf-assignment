export function parseRetryAfter(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const secs = Number(h);
  return Number.isFinite(secs) ? Math.min(secs * 1000, 8000) : undefined;
}

/** Read a short, key-free snippet of an error body for logs. */
export async function readErrorBody(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.replace(/\s+/g, ' ').slice(0, 200);
  } catch {
    return 'unreadable body';
  }
}
