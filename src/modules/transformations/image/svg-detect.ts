// Whether a text starts like an SVG document: an optional XML declaration, then any comments,
// processing instructions, whitespace and one DTD, then an <svg> root. A linear scan with
// indexOf: this runs on the API's event loop before the size limit and the render child, so it
// must never backtrack (a regex over repeated comments is exponential on a crafted input).
export function looksLikeSvg(head: string): boolean {
  let i = 0;
  const skipSpace = (): void => {
    while (i < head.length && /\s/.test(head.charAt(i))) i += 1;
  };
  for (;;) {
    skipSpace();
    if (head.startsWith('<?', i)) {
      const end = head.indexOf('?>', i + 2);
      if (end < 0) return false;
      i = end + 2;
    } else if (head.startsWith('<!--', i)) {
      const end = head.indexOf('-->', i + 4);
      if (end < 0) return false;
      i = end + 3;
    } else if (head.slice(i, i + 9).toUpperCase() === '<!DOCTYPE') {
      const close = head.indexOf('>', i + 9);
      const subset = head.indexOf('[', i + 9);
      if (close < 0) return false;
      if (subset >= 0 && subset < close) {
        const subsetEnd = head.indexOf(']', subset + 1);
        if (subsetEnd < 0) return false;
        const end = head.indexOf('>', subsetEnd + 1);
        if (end < 0) return false;
        i = end + 1;
      } else {
        i = close + 1;
      }
    } else {
      return /^<svg[\s>/]/i.test(head.slice(i, i + 5));
    }
  }
}
