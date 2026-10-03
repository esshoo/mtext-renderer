import { HarfBuzzArabicTextShaper } from './harfbuzzArabicTextShaper'
import type { HarfBuzzRuntime } from './types'

/**
 * Minimal source contract for retrieving raw mesh/OpenType font programs.
 *
 * FontManager already implements this shape through
 * `getCachedMeshFontProgram(fontName)`, so Arabic support can reuse the
 * project's existing IndexedDB font-program cache without adding another
 * byte-retention mechanism to MeshFont.
 */
export interface HarfBuzzFontProgramSource {
  getCachedMeshFontProgram(
    fontName: string
  ): Promise<ArrayBuffer | undefined>
}

/**
 * Creates a HarfBuzz Arabic shaper from an already-cached mesh font program.
 *
 * This helper is intentionally async because the existing font-program cache
 * lives in IndexedDB. Once created, the returned shaper itself remains
 * synchronous and is compatible with the renderer's existing sync layout path.
 *
 * Missing/empty programs and HarfBuzz initialization failures return undefined
 * so a future integration layer can fall back to the original renderer path.
 */
export async function createHarfBuzzArabicTextShaperFromFontProgramSource(
  source: HarfBuzzFontProgramSource,
  runtime: HarfBuzzRuntime,
  fontName: string
): Promise<HarfBuzzArabicTextShaper | undefined> {
  if (!fontName) {
    return undefined
  }

  const program = await source.getCachedMeshFontProgram(fontName)
  if (!(program instanceof ArrayBuffer) || program.byteLength === 0) {
    return undefined
  }

  try {
    return new HarfBuzzArabicTextShaper(runtime, program)
  } catch {
    return undefined
  }
}