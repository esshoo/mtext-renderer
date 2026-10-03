/**
 * Minimal structural API required from a HarfBuzz runtime.
 *
 * The renderer intentionally does not import harfbuzzjs here. Keeping the
 * runtime behind this small interface prevents HarfBuzz's ESM/WASM loading
 * strategy from leaking into the existing UMD/worker builds.
 */
export interface HarfBuzzGlyphInfoAndPosition {
  codepoint: number
  cluster: number
  xAdvance?: number
  yAdvance?: number
  xOffset?: number
  yOffset?: number
}

export interface HarfBuzzBufferLike {
  addText(text: string): void
  guessSegmentProperties(): void
  setDirection(direction: number): void
  setLanguage?(language: string): void
  getGlyphInfosAndPositions(): HarfBuzzGlyphInfoAndPosition[]
}

export interface HarfBuzzFaceLike {
  readonly upem: number
}

export interface HarfBuzzFontLike {
  setScale(xScale: number, yScale: number): void
}

export interface HarfBuzzRuntime {
  readonly Direction: {
    readonly LTR: number
    readonly RTL: number
  }

  readonly Blob: new (data: ArrayBuffer) => unknown
  readonly Face: new (blob: unknown, index: number) => HarfBuzzFaceLike
  readonly Font: new (face: HarfBuzzFaceLike) => HarfBuzzFontLike
  readonly Buffer: new () => HarfBuzzBufferLike

  shape(font: HarfBuzzFontLike, buffer: HarfBuzzBufferLike): void
}