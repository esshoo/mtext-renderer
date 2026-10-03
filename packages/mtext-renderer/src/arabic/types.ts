/**
 * Base paragraph/text-box direction used by optional complex-script support.
 *
 * This is intentionally independent from DXF MText group-code values.
 * It describes editor/renderer layout behavior only.
 */
export type ArabicTextDirection = 'auto' | 'ltr' | 'rtl'

/**
 * One shaped glyph returned by a complex-text shaping backend.
 *
 * `cluster` refers to an index into the original logical Unicode source.
 * A single glyph may represent multiple Unicode code points (for example a
 * ligature), and several glyphs may belong to one logical cluster.
 */
export interface ArabicShapedGlyph {
  glyphId: number
  cluster: number
  xAdvance: number
  yAdvance: number
  xOffset: number
  yOffset: number
}

/**
 * Renderer-neutral shaped output for one logical text run.
 *
 * This type deliberately contains no Three.js objects. The Arabic subsystem
 * only resolves logical text -> glyph/position data; existing renderer code
 * remains responsible for geometry, materials, batching and MTEXT layout.
 */
export interface ArabicShapedRun {
  sourceText: string
  direction: Exclude<ArabicTextDirection, 'auto'>
  glyphs: ArabicShapedGlyph[]
}

/**
 * Request passed to a future Arabic shaping backend.
 *
 * The actual font-handle type is intentionally not specified here yet. That
 * bridge will be added separately so this first phase cannot alter font or
 * rendering behavior.
 */
export interface ArabicShapeRequest {
  text: string
  direction: Exclude<ArabicTextDirection, 'auto'>
  language?: string
}

/**
 * Minimal contract implemented by an Arabic/complex-text shaping backend.
 *
 * `shape()` is synchronous by design because the existing MTextProcessor has
 * a synchronous render path. Backend initialization/loading must therefore be
 * completed before the renderer chooses this path. If it is not ready, the
 * existing renderer path will remain the fallback.
 */
export interface ArabicTextShaper {
  isReady(): boolean
  shape(request: ArabicShapeRequest): ArabicShapedRun | undefined
}

/**
 * Opt-in Arabic shaping configuration for MTextProcessor.
 *
 * The shaper must be built from the same loaded mesh font named by `fontName`.
 */
export interface ArabicMTextShapingOptions {
  fontName: string
  shaper: ArabicTextShaper
  direction?: Exclude<ArabicTextDirection, 'auto'>
  language?: string
}
