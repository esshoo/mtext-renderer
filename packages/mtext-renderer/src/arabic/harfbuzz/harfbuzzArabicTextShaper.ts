import type {
  ArabicShapedRun,
  ArabicShapeRequest,
  ArabicTextShaper
} from '../types'
import type {
  HarfBuzzFontLike,
  HarfBuzzRuntime
} from './types'

/**
 * Shapes one already-directional Arabic text run with an injected HarfBuzz
 * runtime.
 *
 * This class performs shaping only. It does not run the Unicode Bidirectional
 * Algorithm, create Three.js geometry, alter MTEXT formatting, or participate
 * in the renderer unless a later integration layer explicitly chooses it.
 */
export class HarfBuzzArabicTextShaper implements ArabicTextShaper {
  private readonly runtime: HarfBuzzRuntime
  private readonly font: HarfBuzzFontLike

  constructor(runtime: HarfBuzzRuntime, fontData: ArrayBuffer) {
    this.runtime = runtime

    const blob = new runtime.Blob(fontData.slice(0))
    const face = new runtime.Face(blob, 0)
    const font = new runtime.Font(face)

    font.setScale(face.upem, face.upem)
    this.font = font
  }

  isReady(): boolean {
    return true
  }

  shape(request: ArabicShapeRequest): ArabicShapedRun | undefined {
    const { text, direction, language } = request

    if (text.length === 0) {
      return {
        sourceText: text,
        direction,
        glyphs: []
      }
    }

    const buffer = new this.runtime.Buffer()
    buffer.addText(text)

    // Let HarfBuzz infer script/language defaults from the logical Unicode
    // source, then override only the run direction supplied by our layout layer.
    buffer.guessSegmentProperties()
    buffer.setDirection(
      direction === 'rtl'
        ? this.runtime.Direction.RTL
        : this.runtime.Direction.LTR
    )

    if (language && buffer.setLanguage) {
      buffer.setLanguage(language)
    }

    this.runtime.shape(this.font, buffer)

    const shaped = buffer.getGlyphInfosAndPositions()

    // Glyph 0 is .notdef. Returning undefined lets the future integration layer
    // fall back to the original renderer instead of drawing a broken shaped run.
    if (shaped.some(glyph => glyph.codepoint <= 0)) {
      return undefined
    }

    return {
      sourceText: text,
      direction,
      glyphs: shaped.map(glyph => ({
        glyphId: glyph.codepoint,
        cluster: glyph.cluster,
        xAdvance: glyph.xAdvance ?? 0,
        yAdvance: glyph.yAdvance ?? 0,
        xOffset: glyph.xOffset ?? 0,
        yOffset: glyph.yOffset ?? 0
      }))
    }
  }
}