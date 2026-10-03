import * as harfbuzz from 'harfbuzzjs'
import { describe, expect, it } from 'vitest'

import { HarfBuzzArabicTextShaper } from '../../src/arabic/harfbuzz'
import type { HarfBuzzRuntime } from '../../src/arabic/harfbuzz'

// Use an OFL-licensed Arabic TTF. HarfBuzz's raw OpenType face path expects
// an sfnt font here; the project's browser WOFF files are handled separately
// by opentype.js in the existing MeshFont pipeline.
const FONT_URL =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notonaskharabic/NotoNaskhArabic%5Bwght%5D.ttf'

async function loadArabicTestFont(): Promise<ArrayBuffer> {
  const response = await fetch(FONT_URL)
  if (!response.ok) {
    throw new Error('Failed to fetch Noto Naskh Arabic test font')
  }
  return response.arrayBuffer()
}

describe('HarfBuzzArabicTextShaper', () => {
  it(
    'performs real contextual Arabic shaping without renderer integration',
    async () => {
      const fontData = await loadArabicTestFont()
      const shaper = new HarfBuzzArabicTextShaper(
        harfbuzz as unknown as HarfBuzzRuntime,
        fontData
      )

      expect(shaper.isReady()).toBe(true)

      const lamAlef = shaper.shape({
        text: 'لا',
        direction: 'rtl',
        language: 'ar'
      })

      expect(lamAlef).toBeDefined()
      expect(lamAlef!.direction).toBe('rtl')
      expect(lamAlef!.glyphs.length).toBeGreaterThan(0)
      // Do not assert a one-glyph Lam-Alef ligature here. OpenType fonts are
      // allowed to realize the visual ligature with one or multiple glyphs.
      expect(lamAlef!.glyphs.every(glyph => glyph.glyphId > 0)).toBe(true)

      const word = shaper.shape({
        text: 'سلام',
        direction: 'rtl',
        language: 'ar'
      })

      expect(word).toBeDefined()
      expect(word!.glyphs.length).toBeGreaterThan(0)
      expect(
        word!.glyphs.some(
          glyph =>
            glyph.xAdvance !== 0 ||
            glyph.xOffset !== 0 ||
            glyph.yOffset !== 0
        )
      ).toBe(true)

      // Verify contextual Arabic shaping with a stable invariant:
      // Seen is isolated in "س" but initial/joining in "سلام". HarfBuzz/OpenType
      // should therefore resolve a different glyph ID for cluster 0.
      const isolatedSeen = shaper.shape({
        text: 'س',
        direction: 'rtl',
        language: 'ar'
      })

      expect(isolatedSeen).toBeDefined()
      expect(isolatedSeen!.glyphs).toHaveLength(1)

      const joinedSeen = word!.glyphs.find(glyph => glyph.cluster === 0)
      expect(joinedSeen).toBeDefined()
      expect(joinedSeen!.glyphId).not.toBe(isolatedSeen!.glyphs[0].glyphId)

      const empty = shaper.shape({
        text: '',
        direction: 'rtl',
        language: 'ar'
      })
      expect(empty).toEqual({
        sourceText: '',
        direction: 'rtl',
        glyphs: []
      })
    },
    120_000
  )
})