import * as THREE from 'three'

import type { MeshFont, MeshGlyphOutline } from '../../font/meshFont'
import { markMeshGlyphGeometry } from '../../font/meshGlyphGeometry'
import type { ArabicShapedGlyph } from '../types'

/**
 * Geometry + em-normalized HarfBuzz placement data for one shaped mesh glyph.
 *
 * Geometry is generated at canonical size 1. The future MText integration can
 * therefore apply the same current font-size transform used by existing mesh
 * glyph placement.
 */
export interface ArabicShapedMeshGlyphGeometry {
  glyphId: number
  cluster: number
  geometry: THREE.BufferGeometry
  xAdvance: number
  yAdvance: number
  xOffset: number
  yOffset: number
}

/**
 * Converts an opentype.js glyph outline into a Three.js ShapePath.
 *
 * OpenType command semantics:
 * - M: move
 * - L: line
 * - Q: quadratic control (x1/y1) + end (x/y)
 * - C: cubic controls (x1/y1, x2/y2) + end (x/y)
 * - Z: close contour
 */
function outlineToShapePath(
  outline: MeshGlyphOutline,
  scale: number
): THREE.ShapePath {
  const path = new THREE.ShapePath()

  for (const command of outline.commands) {
    const type = command.type.toUpperCase()

    switch (type) {
      case 'M':
        path.moveTo((command.x ?? 0) * scale, (command.y ?? 0) * scale)
        break
      case 'L':
        path.lineTo((command.x ?? 0) * scale, (command.y ?? 0) * scale)
        break
      case 'Q':
        path.quadraticCurveTo(
          (command.x1 ?? 0) * scale,
          (command.y1 ?? 0) * scale,
          (command.x ?? 0) * scale,
          (command.y ?? 0) * scale
        )
        break
      case 'C':
        path.bezierCurveTo(
          (command.x1 ?? 0) * scale,
          (command.y1 ?? 0) * scale,
          (command.x2 ?? 0) * scale,
          (command.y2 ?? 0) * scale,
          (command.x ?? 0) * scale,
          (command.y ?? 0) * scale
        )
        break
      case 'Z':
        path.currentPath?.closePath()
        break
    }
  }

  return path
}

/**
 * Returns false when any generated position contains NaN/Infinity.
 */
function hasFinitePositions(geometry: THREE.BufferGeometry): boolean {
  const position = geometry.getAttribute('position')
  if (!position || position.count === 0) {
    return true
  }

  const array = position.array as ArrayLike<number>
  for (let index = 0; index < array.length; index++) {
    if (!Number.isFinite(array[index])) {
      return false
    }
  }

  return true
}

/**
 * Creates canonical Three.js mesh geometry for one HarfBuzz-shaped glyph.
 *
 * The function uses the glyph ID already resolved by HarfBuzz and retrieves the
 * matching outline from the same MeshFont. Placement metrics are normalized by
 * the font's units-per-em (`resolution`) so the existing renderer can later
 * scale geometry and advances together by the active font size.
 *
 * Empty-outline glyphs (for example spacing glyphs) are valid and return an
 * empty BufferGeometry while preserving their advance/offset metrics.
 */
export function createArabicShapedMeshGlyphGeometry(
  font: MeshFont,
  glyph: ArabicShapedGlyph
): ArabicShapedMeshGlyphGeometry | undefined {
  const resolution = font.data.resolution
  if (!Number.isFinite(resolution) || resolution <= 0) {
    return undefined
  }

  const outline = font.getGlyphOutlineById(glyph.glyphId)
  if (!outline) {
    return undefined
  }

  const scale = 1 / resolution
  const shapePath = outlineToShapePath(outline, scale)
  const shapes = shapePath.toShapes(false)
  const geometry = new THREE.ShapeGeometry(shapes, 4)

  if (!hasFinitePositions(geometry)) {
    geometry.dispose()
    return undefined
  }

  if (geometry.hasAttribute('uv')) {
    geometry.deleteAttribute('uv')
  }
  if (geometry.hasAttribute('normal')) {
    geometry.deleteAttribute('normal')
  }

  markMeshGlyphGeometry(geometry)

  return {
    glyphId: glyph.glyphId,
    cluster: glyph.cluster,
    geometry,
    xAdvance: glyph.xAdvance / resolution,
    yAdvance: glyph.yAdvance / resolution,
    xOffset: glyph.xOffset / resolution,
    yOffset: glyph.yOffset / resolution
  }
}