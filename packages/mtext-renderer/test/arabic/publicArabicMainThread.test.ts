import { MTextColor } from '@mlightcad/mtext-parser'
import * as harfbuzz from 'harfbuzzjs'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type ArabicMTextShapingOptions,
  FontManager,
  HarfBuzzArabicTextShaper,
  type HarfBuzzRuntime,
  MainThreadRenderer,
  MTextAttachmentPoint,
  MTextFlowDirection,
  type TextStyle
} from '../../src'

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

function countMeshVertices(root: THREE.Object3D): number {
  let count = 0
  root.traverse(object => {
    if (object instanceof THREE.Mesh) {
      count += object.geometry.getAttribute('position')?.count ?? 0
    }
  })
  return count
}

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()!()
  }
  vi.restoreAllMocks()
})

describe('public Arabic main-thread wiring', () => {
  it(
    'routes MainThreadRenderer -> MText -> MTextProcessor only after explicit opt-in',
    async () => {
      const manager = FontManager.instance
      const previousCacheSetting = manager.enableFontCache
      manager.enableFontCache = false
      manager.release(FONT_NAME)

      cleanups.push(() => {
        manager.release(FONT_NAME)
        manager.enableFontCache = previousCacheSetting
      })

      const fontBytes = await loadArabicFont()
      const status = await manager.cacheFont(
        fontBytes.slice(0),
        `${FONT_NAME}.ttf`,
        [FONT_NAME]
      )
      expect(status.status).toBe('Success')

      const realShaper = new HarfBuzzArabicTextShaper(
        harfbuzz as unknown as HarfBuzzRuntime,
        fontBytes
      )
      const shape = vi.fn(realShaper.shape.bind(realShaper))

      const shaping: ArabicMTextShapingOptions = {
        fontName: FONT_NAME,
        shaper: {
          isReady: () => true,
          shape
        },
        direction: 'rtl',
        language: 'ar'
      }

      const style: TextStyle = {
        name: 'ArabicPublicTest',
        standardFlag: 0,
        fixedTextHeight: 0,
        widthFactor: 1,
        obliqueAngle: 0,
        textGenerationFlag: 0,
        lastHeight: 24,
        font: FONT_NAME,
        bigFont: ''
      }

      const content = {
        text: ARABIC_WORD,
        height: 24,
        width: 0,
        position: { x: 0, y: 0, z: 0 },
        attachmentPoint: MTextAttachmentPoint.BaselineLeft,
        drawingDirection: MTextFlowDirection.LEFT_TO_RIGHT,
        collectCharBoxes: true
      }

      const colors = {
        layer: '0',
        color: new MTextColor(256),
        byLayerColor: 0xffffff,
        byBlockColor: 0xffffff
      }

      const renderer = new MainThreadRenderer()
      cleanups.push(() => renderer.destroy())

      renderer.setArabicShaping(shaping)
      const shapedOutput = renderer.syncRenderMText(
        content,
        style,
        colors
      )

      expect(shape).toHaveBeenCalledTimes(1)
      expect(countMeshVertices(shapedOutput)).toBeGreaterThan(0)
      expect(
        shapedOutput.createLayoutData().chars.map(entry => entry.char)
      ).toEqual(Array.from(ARABIC_WORD))

      renderer.setArabicShaping(undefined)
      shape.mockClear()

      const legacyOutput = renderer.syncRenderMText(
        content,
        style,
        colors
      )

      expect(shape).not.toHaveBeenCalled()
      expect(countMeshVertices(legacyOutput)).toBeGreaterThan(0)
    },
    120_000
  )
})
