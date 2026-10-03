import { describe, expect, it, vi } from 'vitest'

import {
  createHarfBuzzArabicTextShaperFromFontProgramSource,
  type HarfBuzzFontProgramSource,
  type HarfBuzzRuntime
} from '../../src/arabic/harfbuzz'

function createFakeRuntime(): HarfBuzzRuntime {
  class FakeBlob {
    constructor(_data: ArrayBuffer) {}
  }

  class FakeFace {
    readonly upem = 1000

    constructor(_blob: unknown, _index: number) {}
  }

  class FakeFont {
    setScale(_xScale: number, _yScale: number): void {}
  }

  class FakeBuffer {
    private text = ''

    addText(text: string): void {
      this.text = text
    }

    guessSegmentProperties(): void {}

    setDirection(_direction: number): void {}

    setLanguage(_language: string): void {}

    getGlyphInfosAndPositions() {
      if (!this.text) {
        return []
      }
      return [
        {
          codepoint: 42,
          cluster: 0,
          xAdvance: 500,
          yAdvance: 0,
          xOffset: 0,
          yOffset: 0
        }
      ]
    }
  }

  return {
    Direction: {
      LTR: 4,
      RTL: 5
    },
    Blob: FakeBlob,
    Face: FakeFace,
    Font: FakeFont,
    Buffer: FakeBuffer,
    shape: () => {}
  }
}

describe('HarfBuzz font-program source bridge', () => {
  it('creates a synchronous shaper from cached program bytes', async () => {
    const program = new Uint8Array([1, 2, 3, 4]).buffer
    const source: HarfBuzzFontProgramSource = {
      getCachedMeshFontProgram: vi.fn(async fontName =>
        fontName === 'arabic-test' ? program : undefined
      )
    }

    const shaper =
      await createHarfBuzzArabicTextShaperFromFontProgramSource(
        source,
        createFakeRuntime(),
        'arabic-test'
      )

    expect(source.getCachedMeshFontProgram).toHaveBeenCalledWith(
      'arabic-test'
    )
    expect(shaper).toBeDefined()
    expect(shaper!.isReady()).toBe(true)

    const shaped = shaper!.shape({
      text: 'سلام',
      direction: 'rtl',
      language: 'ar'
    })

    expect(shaped).toBeDefined()
    expect(shaped!.glyphs).toEqual([
      {
        glyphId: 42,
        cluster: 0,
        xAdvance: 500,
        yAdvance: 0,
        xOffset: 0,
        yOffset: 0
      }
    ])
  })

  it('returns undefined when the font program is unavailable', async () => {
    const source: HarfBuzzFontProgramSource = {
      getCachedMeshFontProgram: vi.fn(async () => undefined)
    }

    const shaper =
      await createHarfBuzzArabicTextShaperFromFontProgramSource(
        source,
        createFakeRuntime(),
        'missing-font'
      )

    expect(shaper).toBeUndefined()
  })

  it('does not query the source for an empty font name', async () => {
    const source: HarfBuzzFontProgramSource = {
      getCachedMeshFontProgram: vi.fn(async () => new ArrayBuffer(4))
    }

    const shaper =
      await createHarfBuzzArabicTextShaperFromFontProgramSource(
        source,
        createFakeRuntime(),
        ''
      )

    expect(shaper).toBeUndefined()
    expect(source.getCachedMeshFontProgram).not.toHaveBeenCalled()
  })
})