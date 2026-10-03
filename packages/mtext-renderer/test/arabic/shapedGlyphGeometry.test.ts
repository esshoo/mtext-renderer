import * as harfbuzz from 'harfbuzzjs'
import { describe, expect, it } from 'vitest'

import { HarfBuzzArabicTextShaper } from '../../src/arabic/harfbuzz'
import type { HarfBuzzRuntime } from '../../src/arabic/harfbuzz'
import { createArabicShapedMeshGlyphGeometry } from '../../src/arabic/layout'
import { FontData } from '../../src/font/font'
import { FontFactory } from '../../src/font/fontFactory'
import { isMeshGlyphGeometry } from '../../src/font/meshGlyphGeometry'
import { MeshFont } from '../../src/font/meshFont'

const FONT_URL =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notonaskharabic/NotoNaskhArabic%5Bwght%5D.ttf'

async function loadArabicFont(): Promise<ArrayBuffer> {
  const response = await fetch(FONT_URL)
  if (!response.ok) {
    throw new Error('Failed to fetch Noto Naskh Arabic test font')
  }
  return response.arrayBuffer()
}

describe('Arabic shaped glyph geometry', () => {
  it(
    'maps real HarfBuzz glyph IDs through MeshFont into finite Three.js geometry',
    async () => {
      const fontBytes = await loadArabicFont()

      const fontData: FontData = {
        name: 'noto-naskh-arabic',
        alias: ['noto-naskh-arabic'],
        type: 'mesh',
        data: fontBytes.slice(0)
      }
      const meshFont = FontFactory.instance.createFont(fontData) as MeshFont

      const shaper = new HarfBuzzArabicTextShaper(
        harfbuzz as unknown as HarfBuzzRuntime,
        fontBytes
      )

      const shaped = shaper.shape({
        text: 'سلام',
        direction: 'rtl',
        language: 'ar'
      })

      expect(shaped).toBeDefined()
      expect(shaped!.glyphs.length).toBeGreaterThan(0)

      const entries = shaped!.glyphs.map(glyph =>
        createArabicShapedMeshGlyphGeometry(meshFont, glyph)
      )

      expect(entries.every(entry => entry !== undefined)).toBe(true)

      const resolved = entries.filter(
        entry => entry !== undefined
      )

      expect(resolved).toHaveLength(shaped!.glyphs.length)
      expect(
        resolved.every(
          entry =>
            Number.isFinite(entry.xAdvance) &&
            Number.isFinite(entry.yAdvance) &&
            Number.isFinite(entry.xOffset) &&
            Number.isFinite(entry.yOffset)
        )
      ).toBe(true)

      const visible = resolved.filter(
        entry =>
          (entry.geometry.getAttribute('position')?.count ?? 0) > 0
      )

      expect(visible.length).toBeGreaterThan(0)
      expect(
        visible.every(entry => isMeshGlyphGeometry(entry.geometry))
      ).toBe(true)

      for (const entry of resolved) {
        const position = entry.geometry.getAttribute('position')
        if (position) {
          const values = position.array as ArrayLike<number>
          for (let index = 0; index < values.length; index++) {
            expect(Number.isFinite(values[index])).toBe(true)
          }
        }
        entry.geometry.dispose()
      }
    },
    120_000
  )
})