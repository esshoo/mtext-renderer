import * as THREE from 'three'

import type { FontManager } from '../../font/fontManager'
import { MeshFont } from '../../font/meshFont'
import { createArabicShapedMeshGlyphGeometry } from '../layout'
import { isArabicShapingCandidate } from '../scriptDetection'
import type { ArabicMTextShapingOptions } from '../types'

export interface PrepareArabicWordRequest {
  text: string
  config?: ArabicMTextShapingOptions
  fontManager: FontManager
  activeFontName: string
  wordSpace: number
  distributed: boolean
  slanted: boolean
  fontSize: number
  widthFactor: number
}

export interface PreparedArabicGlyph {
  geometry: THREE.BufferGeometry
  cluster: number
  x: number
  y: number
}

export interface PreparedArabicWord {
  text: string
  runAdvance: number
  geometryScale: number
  glyphs: PreparedArabicGlyph[]
  clusterStarts: number[]
  clusterOrigins: ReadonlyMap<number, number>
}

export interface ArabicWordMeshEntry {
  geometry: THREE.BufferGeometry
  matrix: THREE.Matrix4
}

export interface ArabicLogicalCharBox {
  char: string
  box: THREE.Box3
}

export interface RenderPreparedArabicWordRequest {
  prepared: PreparedArabicWord
  runStartX: number
  baselineY: number
  layoutFontSize: number
  collectCharBoxes: boolean
  buildMatrix: (
    x: number,
    y: number,
    geometryScale: number
  ) => THREE.Matrix4
}

export interface RenderedArabicWord {
  meshEntries: ArabicWordMeshEntry[]
  charBoxes: ArabicLogicalCharBox[]
  ownedGeometries: THREE.BufferGeometry[]
}

/**
 * Shapes and prepares one Arabic word without mutating renderer state.
 *
 * Unsupported cases return undefined so MTextProcessor can execute its
 * unchanged legacy processWord path.
 */
export function prepareArabicWord(
  request: PrepareArabicWordRequest
): PreparedArabicWord | undefined {
  const {
    text,
    config,
    fontManager,
    activeFontName,
    wordSpace,
    distributed,
    slanted,
    fontSize,
    widthFactor
  } = request

  if (
    !config ||
    !config.shaper.isReady() ||
    !isArabicShapingCandidate(text) ||
    wordSpace !== 1 ||
    distributed ||
    slanted
  ) {
    return undefined
  }

  const activeFont = fontManager.getFontByName(activeFontName, false)
  const configuredFont = fontManager.getFontByName(config.fontName, false)
  if (!(activeFont instanceof MeshFont) || configuredFont !== activeFont) {
    return undefined
  }

  const shaped = config.shaper.shape({
    text,
    direction: config.direction ?? 'rtl',
    language: config.language ?? 'ar'
  })
  if (!shaped || shaped.glyphs.length === 0) {
    return undefined
  }

  const resolved = []
  for (const glyph of shaped.glyphs) {
    const entry = createArabicShapedMeshGlyphGeometry(activeFont, glyph)
    if (!entry) {
      for (const created of resolved) {
        created.geometry.dispose()
      }
      return undefined
    }
    resolved.push(entry)
  }

  let penX = 0
  let penY = 0
  let minPenX = 0
  let maxPenX = 0

  const positioned = resolved.map(entry => {
    const startX = penX
    const glyphX = penX + entry.xOffset
    const glyphY = penY + entry.yOffset
    penX += entry.xAdvance
    penY += entry.yAdvance
    minPenX = Math.min(minPenX, startX, glyphX, penX)
    maxPenX = Math.max(maxPenX, startX, glyphX, penX)
    return { entry, glyphX, glyphY }
  })

  const horizontalScale = fontSize * widthFactor
  const runAdvance = (maxPenX - minPenX) * horizontalScale
  if (!Number.isFinite(runAdvance) || runAdvance <= 0) {
    resolved.forEach(entry => entry.geometry.dispose())
    return undefined
  }

  const clusterOrigins = new Map<number, number>()
  const glyphs: PreparedArabicGlyph[] = []

  for (const { entry, glyphX, glyphY } of positioned) {
    const x = (glyphX - minPenX) * horizontalScale
    const y = glyphY * fontSize

    if (!clusterOrigins.has(entry.cluster)) {
      clusterOrigins.set(entry.cluster, x)
    }

    const position = entry.geometry.getAttribute('position')
    if (!position || position.count === 0) {
      entry.geometry.dispose()
      continue
    }

    glyphs.push({
      geometry: entry.geometry,
      cluster: entry.cluster,
      x,
      y
    })
  }

  // Do not mutate layout state and then discover that the shaped run has no
  // drawable geometry. Falling back must be side-effect free.
  if (glyphs.length === 0) {
    return undefined
  }

  const clusterStarts = [
    ...new Set(
      shaped.glyphs
        .map(glyph => glyph.cluster)
        .filter(
          cluster =>
            Number.isInteger(cluster) &&
            cluster >= 0 &&
            cluster <= text.length
        )
    )
  ]
  if (!clusterStarts.includes(0)) {
    clusterStarts.push(0)
  }
  clusterStarts.sort((a, b) => a - b)

  return {
    text,
    runAdvance,
    geometryScale: fontSize,
    glyphs,
    clusterStarts,
    clusterOrigins
  }
}

/**
 * Applies renderer-provided transforms to a prepared Arabic word and creates
 * logical source-character boxes. No MTextProcessor state is accessed here.
 */
export function renderPreparedArabicWord(
  request: RenderPreparedArabicWordRequest
): RenderedArabicWord {
  const {
    prepared,
    runStartX,
    baselineY,
    layoutFontSize,
    collectCharBoxes,
    buildMatrix
  } = request

  const meshEntries: ArabicWordMeshEntry[] = []
  const charBoxes: ArabicLogicalCharBox[] = []
  const ownedGeometries: THREE.BufferGeometry[] = []
  const clusterBoxes = new Map<number, THREE.Box3>()

  for (const glyph of prepared.glyphs) {
    const matrix = buildMatrix(
      runStartX + glyph.x,
      baselineY + glyph.y,
      prepared.geometryScale
    )

    meshEntries.push({
      geometry: glyph.geometry,
      matrix
    })
    ownedGeometries.push(glyph.geometry)

    if (collectCharBoxes) {
      if (!glyph.geometry.boundingBox) {
        glyph.geometry.computeBoundingBox()
      }
      const transformed = new THREE.Box3()
        .copy(glyph.geometry.boundingBox!)
        .applyMatrix4(matrix)
      const current = clusterBoxes.get(glyph.cluster)
      if (current) {
        current.union(transformed)
      } else {
        clusterBoxes.set(glyph.cluster, transformed)
      }
    }
  }

  if (collectCharBoxes) {
    for (let index = 0; index < prepared.clusterStarts.length; index++) {
      const start = prepared.clusterStarts[index]
      const end = prepared.clusterStarts[index + 1] ?? prepared.text.length
      if (end <= start) {
        continue
      }

      const logicalText = prepared.text.slice(start, end)
      const originX =
        runStartX + (prepared.clusterOrigins.get(start) ?? 0)
      const box =
        clusterBoxes.get(start) ??
        new THREE.Box3(
          new THREE.Vector3(originX, baselineY, 0),
          new THREE.Vector3(originX, baselineY + layoutFontSize, 0)
        )

      // Preserve the existing one-box-per-logical-character contract.
      // Ligature members share the same visual box until cluster-aware cursor
      // metadata is introduced in the input-box phase.
      for (const char of logicalText) {
        charBoxes.push({
          char,
          box: new THREE.Box3().copy(box)
        })
      }
    }
  }

  return {
    meshEntries,
    charBoxes,
    ownedGeometries
  }
}
