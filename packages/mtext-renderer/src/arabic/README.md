# Arabic / Complex Text Support

This folder is intentionally isolated from the existing MTEXT implementation.

## Compatibility rules

1. Existing Latin, CJK and SHX rendering must keep using the original code path.
2. Arabic support must operate on logical Unicode text; never store Arabic
   Presentation Forms in MTEXT source.
3. MTEXT parsing/formatting remains owned by the existing parser and
   `MTextProcessor`.
4. Arabic shaping outputs glyph IDs, clusters and positioning only.
5. Three.js geometry/material/batching remains owned by the existing renderer.
6. Arabic support is opt-in until the integration is proven regression-free.
7. If Arabic shaping is unavailable or fails, rendering must fall back to the
   original path rather than failing the complete MTEXT entity.

## Planned layers

- `scriptDetection.ts`: determines whether a run needs complex Arabic shaping.
- `types.ts`: renderer-neutral shaping contracts.
- Future `bidi/`: Unicode BiDi/text-box direction resolution.
- Future `harfbuzz/`: HarfBuzz adapter.
- Future `layout/`: cluster/caret metadata integration.

Phase 1A contains no renderer hook and therefore cannot change existing output.
