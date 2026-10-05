(function (root) {
  function parseLrc(text) {
    const lines = [];
    const offset = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0);
    for (const row of text.split(/\r?\n/)) {
      const tags = [...row.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      const content = row.replace(/\[[^\]]*\]/g, '').trim();
      for (const tag of tags) lines.push({ time: Math.max(0, Number(tag[1]) * 60000 + Number(tag[2]) * 1000 + Number((tag[3] || '0').padEnd(3, '0')) + offset), text: content });
    }
    return lines.sort((a, b) => a.time - b.time);
  }
  function currentLine(lines, position) {
    let low = 0, high = lines.length - 1, found = -1;
    while (low <= high) { const mid = (low + high) >> 1; if (lines[mid].time <= position) { found = mid; low = mid + 1; } else high = mid - 1; }
    return found;
  }
  function positionAt(playback, elapsed) {
    return Math.min(playback.duration_ms || Infinity, Math.max(0, playback.progress_ms + (playback.is_playing ? Math.max(0, elapsed) : 0)));
  }
  const api = { parseLrc, currentLine, positionAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LyricSync = api;
})(globalThis);
