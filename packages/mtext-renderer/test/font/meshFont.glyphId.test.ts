import { parse } from 'opentype.js'
import { describe, expect, it } from 'vitest'

import { FontData } from '../../src/font/font'
import { FontFactory } from '../../src/font/fontFactory'
import { MeshFont } from '../../src/font/meshFont'

const FONT_BASE = 'https://cdn.jsdelivr.net/gh/mlightcad/cad-data/fonts/'

async function loadMeshFontWithGlyphId(
  name: string,
  file: string,
  char: string
): Promise<{ font: MeshFont; glyphId: number }> {
  const response = await fetch(FONT_BASE + file)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${file}`)
  }

  const buffer = await response.arrayBuffer()
  const parsed = parse(buffer.slice(0))
  const glyphId = parsed.charToGlyphIndex(char)

  const fontData: FontData = {
    name,
    type: 'mesh',
    data: buffer,
    alias: [name]
  }

  return {
    font: FontFactory.instance.createFont(fontData) as MeshFont,
    glyphId
  }
}

describe('MeshFont glyph-id bridge', () => {
  it(
    'reads an OpenType glyph outline by glyph ID without changing char APIs',
    async () => {
      const { font, glyphId } = await loadMeshFontWithGlyphId(
        'simsun',
        'simsun.ttf',
        'A'
      )

      expect(glyphId).toBeGreaterThan(0)

      // The new bridge must not populate the renderer's character-glyph cache.
      expect(font.data.glyphs.A).toBeUndefined()

      const outline = font.getGlyphOutlineById(glyphId)
      expect(outline).toBeDefined()
      expect(outline!.glyphId).toBe(glyphId)
      expect(outline!.advanceWidth).toBeGreaterThan(0)
      expect(outline!.commands.length).toBeGreaterThan(0)

      // Existing character path still behaves exactly as before.
      expect(font.data.glyphs.A).toBeUndefined()
      const charShape = font.getCharShape('A', 10)
      expect(charShape).toBeDefined()
      expect(font.data.glyphs.A).toBeDefined()

      expect(font.getGlyphOutlineById(0)).toBeUndefined()
      expect(font.getGlyphOutlineById(-1)).toBeUndefined()
      expect(font.getGlyphOutlineById(1.5)).toBeUndefined()
    },
    120_000
  )
})