import * as harfbuzz from 'harfbuzzjs'
import { describe, expect, it } from 'vitest'

import type {
  ArabicWorkerShapingOptions,
  HarfBuzzFontProgramSource,
  HarfBuzzRuntime
} from '../../src'
import {
  createArabicWorkerShapingOptions
} from '../../src/arabic/worker'

const FONT_NAME = 'noto-naskh-arabic'
const FONT_URL =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notonaskharabic/NotoNaskhArabic%5Bwght%5D.ttf'
const ARABIC_WORD = '\u0633\u0644\u0627\u0645'

async function loadArabicFont(): Promise<ArrayBuffer> {
  const response = await fetch(FONT_URL)
  if (!response.ok) {
    throw new Error('Failed to fetch Noto Naskh Arabic test font')
  }
  return response.arrayBuffer()
}

describe('Arabic worker shaping factory', () => {
  it(
    'builds a real HarfBuzz shaper from serializable config and cached font bytes',
    async () => {
      const fontBytes = await loadArabicFont()

      const source: HarfBuzzFontProgramSource = {
        getCachedMeshFontProgram: async fontName =>
          fontName === FONT_NAME ? fontBytes.slice(0) : undefined
      }

      const options: ArabicWorkerShapingOptions = {
        fontName: FONT_NAME,
        runtimeModuleUrl: 'https://example.invalid/harfbuzz/index.mjs',
        direction: 'rtl',
        language: 'ar'
      }

      expect(structuredClone(options)).toEqual(options)

      const shaping = await createArabicWorkerShapingOptions(
        source,
        options,
        async () => harfbuzz as unknown as HarfBuzzRuntime
      )

      expect(shaping).toBeDefined()
      expect(shaping?.fontName).toBe(FONT_NAME)
      expect(shaping?.shaper.isReady()).toBe(true)

      const shaped = shaping?.shaper.shape({
        text: ARABIC_WORD,
        direction: 'rtl',
        language: 'ar'
      })

      expect(shaped).toBeDefined()
      expect(shaped!.glyphs.length).toBeGreaterThan(0)
      expect(shaped!.glyphs.every(glyph => glyph.glyphId > 0)).toBe(true)
    },
    120_000
  )

  it('returns undefined when the cached font program is unavailable', async () => {
    const source: HarfBuzzFontProgramSource = {
      getCachedMeshFontProgram: async () => undefined
    }

    const shaping = await createArabicWorkerShapingOptions(
      source,
      {
        fontName: FONT_NAME,
        runtimeModuleUrl: 'test://harfbuzz'
      },
      async () => harfbuzz as unknown as HarfBuzzRuntime
    )

    expect(shaping).toBeUndefined()
  })

  it('surfaces runtime module loading failures to the caller', async () => {
    const source: HarfBuzzFontProgramSource = {
      getCachedMeshFontProgram: async () => new ArrayBuffer(4)
    }

    await expect(
      createArabicWorkerShapingOptions(
        source,
        {
          fontName: FONT_NAME,
          runtimeModuleUrl: 'https://bad.invalid/hb.mjs'
        },
        async () => {
          throw new Error('runtime unavailable')
        }
      )
    ).rejects.toThrow('runtime unavailable')
  })
})
