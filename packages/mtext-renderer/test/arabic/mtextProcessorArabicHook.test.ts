import { MTextColor, TokenType } from '@mlightcad/mtext-parser'
import * as harfbuzz from 'harfbuzzjs'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HarfBuzzArabicTextShaper } from '../../src/arabic/harfbuzz'
import type { HarfBuzzRuntime } from '../../src/arabic/harfbuzz'
import { FontManager } from '../../src/font'
import {
  MTextFormatOptions,
  MTextProcessor
} from '../../src/renderer/mtextProcessor'
import { MTextFlowDirection, TextStyle } from '../../src/renderer/types'

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

function collectCharBoxes(root: THREE.Object3D): string[] {
  const chars: string[] = []
  root.traverse(object => {
    const entries = object.userData?.layout?.chars as
      | Array<{ char: string }>
      | undefined
    if (entries) {
      chars.push(...entries.map(entry => entry.char))
    }
  })
  return chars
}

function countMeshVertices(root: THREE.Object3D): number {
  let count = 0
  root.traverse(object => {
    if (object instanceof THREE.Mesh) {
      count += object.geometry.getAttribute('position')?.count ?? 0
    }
  })
  return count
}

async function createProcessor() {
  const fontBytes = await loadArabicFont()
  const manager = FontManager.instance
  manager.release(FONT_NAME)

  const previousCacheSetting = manager.enableFontCache
  manager.enableFontCache = false

  const status = await manager.cacheFont(
    fontBytes.slice(0),
    `${FONT_NAME}.ttf`,
    [FONT_NAME]
  )
  expect(status.status).toBe('Success')

  const style: TextStyle = {
    name: 'ArabicTest',
    standardFlag: 0,
    fixedTextHeight: 0,
    widthFactor: 1,
    obliqueAngle: 0,
    textGenerationFlag: 0,
    lastHeight: 24,
    font: FONT_NAME,
    bigFont: ''
  }

  const options: MTextFormatOptions = {
    fontSize: 24,
    widthFactor: 1,
    lineSpaceFactor: 1,
    horizontalAlignment: 1,
    maxWidth: 0,
    flowDirection: MTextFlowDirection.LEFT_TO_RIGHT,
    byBlockColor: 0xffffff,
    byLayerColor: 0xffffff,
    removeFontExtension: true,
    collectCharBoxes: true
  }

  const styleManager = {
    unsupportedTextStyles: {},
    getMeshBasicMaterial: () =>
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    getLineBasicMaterial: () =>
      new THREE.LineBasicMaterial({ color: 0xffffff })
  }

  const processor = new MTextProcessor(
    style,
    {
      layer: '0',
      color: new MTextColor(256),
      byBlockColor: 0xffffff,
      byLayerColor: 0xffffff
    },
    styleManager,
    manager,
    options
  )

  const realShaper = new HarfBuzzArabicTextShaper(
    harfbuzz as unknown as HarfBuzzRuntime,
    fontBytes
  )

  return {
    processor,
    realShaper,
    cleanup: () => {
      manager.release(FONT_NAME)
      manager.enableFontCache = previousCacheSetting
    }
  }
}

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()!()
  }
})

describe('MTextProcessor Arabic opt-in hook', () => {
  it(
    'stays on the original path until Arabic shaping is enabled',
    async () => {
      const { processor, cleanup } = await createProcessor()
      cleanups.push(cleanup)

      const output = processor.processText([
        { type: TokenType.WORD, ctx: null, data: ARABIC_WORD }
      ] as any)

      expect(countMeshVertices(output)).toBeGreaterThan(0)
      expect(processor.hOffset).toBeGreaterThan(0)
      expect(collectCharBoxes(output)).toEqual(Array.from(ARABIC_WORD))
    },
    120_000
  )
  it(
    'renders pure Arabic through HarfBuzz and keeps logical char boxes',
    async () => {
      const { processor, realShaper, cleanup } = await createProcessor()
      cleanups.push(cleanup)

      processor.setArabicShaping({
        fontName: FONT_NAME,
        shaper: realShaper,
        direction: 'rtl',
        language: 'ar'
      })

      const output = processor.processText([
        { type: TokenType.WORD, ctx: null, data: ARABIC_WORD }
      ] as any)

      expect(countMeshVertices(output)).toBeGreaterThan(0)
      expect(processor.hOffset).toBeGreaterThan(0)
      expect(collectCharBoxes(output)).toEqual(Array.from(ARABIC_WORD))
    },
    120_000
  )

  it(
    'keeps mixed Arabic/Latin words on the original path',
    async () => {
      const { processor, realShaper, cleanup } = await createProcessor()
      cleanups.push(cleanup)

      const shape = vi.fn(realShaper.shape.bind(realShaper))
      processor.setArabicShaping({
        fontName: FONT_NAME,
        shaper: { isReady: () => true, shape },
        direction: 'rtl',
        language: 'ar'
      })

      const output = processor.processText([
        { type: TokenType.WORD, ctx: null, data: `${ARABIC_WORD}A` }
      ] as any)

      expect(shape).not.toHaveBeenCalled()
      expect(countMeshVertices(output)).toBeGreaterThan(0)
    },
    120_000
  )

  it(
    'falls back to the original path when shaping declines the run',
    async () => {
      const { processor, cleanup } = await createProcessor()
      cleanups.push(cleanup)

      processor.setArabicShaping({
        fontName: FONT_NAME,
        shaper: {
          isReady: () => true,
          shape: () => undefined
        },
        direction: 'rtl',
        language: 'ar'
      })

      const output = processor.processText([
        { type: TokenType.WORD, ctx: null, data: ARABIC_WORD }
      ] as any)

      expect(countMeshVertices(output)).toBeGreaterThan(0)
      expect(processor.hOffset).toBeGreaterThan(0)
    },
    120_000
  )
})
