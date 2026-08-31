// Bound decompressed response bytes, including when upstream omits Content-Length.
export async function readBoundedJson(response: Response, maxBytes = 2_000_000): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error('Provider response exceeds the supported size.');
  }
  if (!response.body) throw new Error('Provider response has no body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('Provider response exceeds the supported size.');
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(''));
  } finally {
    reader.releaseLock();
  }
}
