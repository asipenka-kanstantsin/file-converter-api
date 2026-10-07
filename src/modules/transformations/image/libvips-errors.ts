// Messages of libvips for input it cannot read — the client's fault. Anything else (memory,
// a killed operation, an internal limit) is ours: a 500, logged. No path aliases: the SVG render
// child imports it too.
export const LIBVIPS_BAD_INPUT =
  /corrupt|premature|unsupported image|bad (?:image|dimensions|header|huffman)|not a known|invalid|truncated|read error|marker/i;
