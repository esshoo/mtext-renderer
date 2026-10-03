import type * as HarfBuzzTypes from 'harfbuzzjs'
import bidiFactory, { type EmbeddingLevels } from 'bidi-js'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

type HarfBuzzApi = typeof HarfBuzzTypes
type HbGlyph = ReturnType<HarfBuzzTypes.Buffer['getGlyphInfosAndPositions']>[number]
type BaseDirection = 'auto' | 'rtl' | 'ltr'
type RunDirection = 'rtl' | 'ltr'

interface LogicalRun {
  id: number
  start: number
  end: number
  level: number
  direction: RunDirection
  source: string
  shapedSource: string
}

interface RunRenderResult {
  group: THREE.Group
  advance: number
  glyphs: HbGlyph[]
  visibleMeshes: number
}

const bidi = bidiFactory()

const view = document.getElementById('view') as HTMLElement
const fontInput = document.getElementById('font') as HTMLInputElement
const textInput = document.getElementById('text') as HTMLTextAreaElement
const directionInput = document.getElementById('direction') as HTMLSelectElement
const renderButton = document.getElementById('render') as HTMLButtonElement
const status = document.getElementById('status') as HTMLDivElement
const diagnostics = document.getElementById('diag') as HTMLPreElement

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x111318)

const camera = new THREE.OrthographicCamera(-1000, 1000, 500, -500, 0.1, 5000)
camera.position.set(0, 0, 1000)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.domElement.style.display = 'block'
view.appendChild(renderer.domElement)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableRotate = false
controls.screenSpacePanning = true
controls.zoomToCursor = true

let selectedFontBytes: ArrayBuffer | null = null
let renderedGroup: THREE.Group | null = null
let renderedMaterial: THREE.MeshBasicMaterial | null = null
let hbPromise: Promise<HarfBuzzApi> | null = null

function setStatus(message: string, isError = false): void {
  status.textContent = message
  status.style.color = isError ? '#ff8e8e' : '#9dd6ae'
}

window.addEventListener('error', event => {
  const message =
    event.error instanceof Error
      ? `${event.error.name}: ${event.error.message}`
      : event.message
  setStatus(`Runtime error: ${message}`, true)
  diagnostics.textContent = event.error?.stack ?? message
})

window.addEventListener('unhandledrejection', event => {
  const reason =
    event.reason instanceof Error
      ? `${event.reason.name}: ${event.reason.message}`
      : String(event.reason)
  setStatus(`Unhandled promise error: ${reason}`, true)
  diagnostics.textContent =
    event.reason instanceof Error ? event.reason.stack ?? reason : reason
})

async function loadHarfBuzz(): Promise<HarfBuzzApi> {
  if (!hbPromise) {
    const runtimeUrl = new URL(
      './vendor/harfbuzzjs/index.mjs',
      window.location.href
    ).href

    hbPromise = import(/* @vite-ignore */ runtimeUrl) as Promise<HarfBuzzApi>
  }

  return hbPromise
}

function resize(): void {
  const width = Math.max(1, view.clientWidth)
  const height = Math.max(1, view.clientHeight)

  renderer.setSize(width, height, false)

  const halfHeight = 500
  const aspect = width / height
  camera.left = -halfHeight * aspect
  camera.right = halfHeight * aspect
  camera.top = halfHeight
  camera.bottom = -halfHeight
  camera.updateProjectionMatrix()
}

function disposeCurrent(): void {
  if (renderedGroup) {
    renderedGroup.traverse(object => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()

      if (object.userData.pocHelper && object instanceof THREE.Line) {
        const material = object.material
        if (Array.isArray(material)) {
          material.forEach(item => item.dispose())
        } else {
          material.dispose()
        }
      }
    })
    scene.remove(renderedGroup)
    renderedGroup = null
  }

  renderedMaterial?.dispose()
  renderedMaterial = null
}

function glyphCommandsToShapes(
  commands: ReturnType<HarfBuzzTypes.Font['glyphToJson']>
): THREE.Shape[] {
  const shapePath = new THREE.ShapePath()

  for (const command of commands) {
    const values = command.values
    switch (command.type) {
      case 'M':
        shapePath.moveTo(values[0] ?? 0, values[1] ?? 0)
        break
      case 'L':
        shapePath.lineTo(values[0] ?? 0, values[1] ?? 0)
        break
      case 'Q':
        shapePath.quadraticCurveTo(
          values[0] ?? 0,
          values[1] ?? 0,
          values[2] ?? 0,
          values[3] ?? 0
        )
        break
      case 'C':
        shapePath.bezierCurveTo(
          values[0] ?? 0,
          values[1] ?? 0,
          values[2] ?? 0,
          values[3] ?? 0,
          values[4] ?? 0,
          values[5] ?? 0
        )
        break
      case 'Z':
        shapePath.currentPath?.closePath()
        break
    }
  }

  return shapePath.toShapes(false)
}

function createGlyphObject(
  hbFont: HarfBuzzTypes.Font,
  glyphId: number
): THREE.Group {
  const glyphRoot = new THREE.Group()
  const commands = hbFont.glyphToJson(glyphId)

  if (commands.length === 0) {
    return glyphRoot
  }

  for (const shape of glyphCommandsToShapes(commands)) {
    const geometry = new THREE.ShapeGeometry(shape, 6)
    if (geometry.getAttribute('position')?.count === 0) {
      geometry.dispose()
      continue
    }
    glyphRoot.add(new THREE.Mesh(geometry, renderedMaterial!))
  }

  return glyphRoot
}

function normalizeLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function mirrorRunSource(
  source: string,
  start: number,
  end: number,
  embedding: EmbeddingLevels
): string {
  const mirrors = bidi.getMirroredCharactersMap(
    source,
    embedding.levels,
    start,
    end
  )

  let out = ''
  for (let index = start; index <= end; index++) {
    out += mirrors.get(index) ?? source[index] ?? ''
  }
  return out
}

/**
 * Resolves the base direction for the whole MTEXT/text-box.
 *
 * "auto" intentionally differs from per-line Unicode paragraph auto here:
 * CAD text boxes normally need one stable horizontal anchor. We inspect the
 * first strong character in the complete logical source and then force that
 * base direction for every visual line. Unicode BiDi still resolves LTR/RTL
 * runs inside each line, so English and numbers stay in their natural order.
 */
function resolveTextBoxBaseDirection(
  source: string,
  requested: BaseDirection
): RunDirection {
  if (requested === 'rtl' || requested === 'ltr') {
    return requested
  }

  for (const char of source) {
    const type = bidi.getBidiCharTypeName(char)

    if (type === 'R' || type === 'AL') {
      return 'rtl'
    }

    if (type === 'L') {
      return 'ltr'
    }
  }

  // Neutral/empty text: use LTR as a deterministic fallback.
  return 'ltr'
}
function buildVisualRuns(
  source: string,
  baseDirection: BaseDirection
): {
  embedding: EmbeddingLevels
  baseLevel: number
  logicalRuns: LogicalRun[]
  visualRuns: LogicalRun[]
  reorderedIndices: number[]
} {
  const embedding = bidi.getEmbeddingLevels(source, baseDirection)

  if (source.length === 0) {
    return {
      embedding,
      baseLevel: baseDirection === 'rtl' ? 1 : 0,
      logicalRuns: [],
      visualRuns: [],
      reorderedIndices: []
    }
  }

  const levels = embedding.levels
  const logicalRuns: LogicalRun[] = []
  const runIdByIndex = new Int32Array(source.length)

  let runStart = 0
  let runLevel = levels[0] ?? 0

  const pushRun = (start: number, end: number, level: number): void => {
    const id = logicalRuns.length
    const direction: RunDirection = level % 2 === 1 ? 'rtl' : 'ltr'
    const run: LogicalRun = {
      id,
      start,
      end,
      level,
      direction,
      source: source.slice(start, end + 1),
      shapedSource: mirrorRunSource(source, start, end, embedding)
    }

    logicalRuns.push(run)
    for (let index = start; index <= end; index++) {
      runIdByIndex[index] = id
    }
  }

  for (let index = 1; index < source.length; index++) {
    const level = levels[index] ?? runLevel
    if (level !== runLevel) {
      pushRun(runStart, index - 1, runLevel)
      runStart = index
      runLevel = level
    }
  }
  pushRun(runStart, source.length - 1, runLevel)

  const reorderedIndices = bidi.getReorderedIndices(source, embedding)
  const visualRunIds: number[] = []
  let previous = -1

  for (const logicalIndex of reorderedIndices) {
    const runId = runIdByIndex[logicalIndex] ?? 0
    if (runId !== previous) {
      visualRunIds.push(runId)
      previous = runId
    }
  }

  const visualRuns = visualRunIds.map(id => logicalRuns[id]!)
  const baseLevel =
    embedding.paragraphs[0]?.level ??
    (baseDirection === 'rtl' ? 1 : 0)

  return {
    embedding,
    baseLevel,
    logicalRuns,
    visualRuns,
    reorderedIndices
  }
}

function shapeRun(
  hb: HarfBuzzApi,
  font: HarfBuzzTypes.Font,
  run: LogicalRun
): HbGlyph[] {
  const buffer = new hb.Buffer()
  buffer.addText(run.shapedSource)
  buffer.setDirection(
    run.direction === 'rtl' ? hb.Direction.RTL : hb.Direction.LTR
  )
  buffer.guessSegmentProperties()
  hb.shape(font, buffer)
  return buffer.getGlyphInfosAndPositions()
}

function renderRun(
  font: HarfBuzzTypes.Font,
  glyphs: HbGlyph[]
): RunRenderResult {
  const group = new THREE.Group()
  let penX = 0
  let penY = 0
  let minPen = 0
  let maxPen = 0
  let visibleMeshes = 0

  for (const glyph of glyphs) {
    const glyphObject = createGlyphObject(font, glyph.codepoint)

    glyphObject.position.set(
      penX + (glyph.xOffset ?? 0),
      penY + (glyph.yOffset ?? 0),
      0
    )

    visibleMeshes += glyphObject.children.length
    group.add(glyphObject)

    penX += glyph.xAdvance ?? 0
    penY += glyph.yAdvance ?? 0
    minPen = Math.min(minPen, penX)
    maxPen = Math.max(maxPen, penX)
  }

  // Normalize either positive or negative HarfBuzz advances to a left-to-right
  // visual run box. The paragraph layout decides where that run box lives.
  const advance = Math.max(0, maxPen - minPen)
  group.position.x = -minPen

  return { group, advance, glyphs, visibleMeshes }
}

function resolveLineAdvance(font: HarfBuzzTypes.Font, upem: number): number {
  const extents = font.hExtents()
  const typographic =
    Math.abs(extents.ascender - extents.descender) + Math.max(0, extents.lineGap)
  return Math.max(upem * 1.25, typographic * 1.1)
}

function addLineGuide(
  root: THREE.Group,
  baselineY: number,
  startX: number,
  endX: number
): void {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(startX, baselineY, -1),
    new THREE.Vector3(endX, baselineY, -1)
  ])
  const material = new THREE.LineBasicMaterial({ color: 0x334155 })
  const line = new THREE.Line(geometry, material)
  line.userData.pocHelper = true
  root.add(line)
}

function addAnchorGuide(root: THREE.Group, topY: number, bottomY: number): void {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, topY, -2),
    new THREE.Vector3(0, bottomY, -2)
  ])
  const material = new THREE.LineBasicMaterial({ color: 0x475569 })
  const line = new THREE.Line(geometry, material)
  line.userData.pocHelper = true
  root.add(line)
}

function fitCamera(object: THREE.Object3D): void {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)

  if (box.isEmpty()) {
    setStatus('BiDi/shaping succeeded, but no visible geometry was produced.', true)
    return
  }

  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const aspect = Math.max(1, view.clientWidth) / Math.max(1, view.clientHeight)

  const width = Math.max(size.x, 1)
  const height = Math.max(size.y, 1)
  const halfHeight = Math.max(height / 2, width / (2 * aspect)) * 1.25

  camera.left = -halfHeight * aspect
  camera.right = halfHeight * aspect
  camera.top = halfHeight
  camera.bottom = -halfHeight
  camera.position.set(center.x, center.y, 1000)
  camera.updateProjectionMatrix()

  controls.target.set(center.x, center.y, 0)
  controls.update()
}

async function bidiShapeAndRender(): Promise<void> {
  if (!selectedFontBytes) {
    setStatus('Choose a TTF/OTF font first.', true)
    return
  }

  const text = textInput.value
  if (!text) {
    setStatus('Enter some Unicode text.', true)
    return
  }

  const baseDirection = directionInput.value as BaseDirection
  const effectiveBaseDirection = resolveTextBoxBaseDirection(
    text,
    baseDirection
  )

  renderButton.disabled = true
  diagnostics.textContent = ''
  setStatus('Resolving BiDi runs and shaping…')

  try {
    const hb = await loadHarfBuzz()
    const blob = new hb.Blob(selectedFontBytes.slice(0))
    const face = new hb.Face(blob, 0)
    const font = new hb.Font(face)
    font.setScale(face.upem, face.upem)

    const sourceLines = normalizeLines(text)
    const lineAdvance = resolveLineAdvance(font, face.upem)

    disposeCurrent()

    renderedMaterial = new THREE.MeshBasicMaterial({
      color: 0xf3f5f7,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    })

    const root = new THREE.Group()
    const diagnosticsLines: unknown[] = []
    let totalGlyphs = 0
    let totalVisibleMeshes = 0

    sourceLines.forEach((lineSource, lineIndex) => {
      const bidiLine = buildVisualRuns(lineSource, effectiveBaseDirection)
      const lineGroup = new THREE.Group()
      const baselineY = -lineIndex * lineAdvance

      let cursorX = 0
      const runDiagnostics: unknown[] = []

      for (const run of bidiLine.visualRuns) {
        const glyphs = shapeRun(hb, font, run)
        const renderedRun = renderRun(font, glyphs)

        renderedRun.group.position.x += cursorX
        lineGroup.add(renderedRun.group)

        runDiagnostics.push({
          visualOrder: runDiagnostics.length,
          logicalRange: [run.start, run.end],
          level: run.level,
          direction: run.direction,
          source: run.source,
          shapedSource: run.shapedSource,
          advance: renderedRun.advance,
          glyphs: glyphs.map(glyph => ({
            glyphId: glyph.codepoint,
            glyphName: font.glyphName(glyph.codepoint),
            cluster: glyph.cluster,
            xAdvance: glyph.xAdvance ?? 0,
            yAdvance: glyph.yAdvance ?? 0,
            xOffset: glyph.xOffset ?? 0,
            yOffset: glyph.yOffset ?? 0
          }))
        })

        cursorX += renderedRun.advance
        totalGlyphs += glyphs.length
        totalVisibleMeshes += renderedRun.visibleMeshes
      }

      const isRtlParagraph = bidiLine.baseLevel % 2 === 1

      // x=0 is the paragraph anchor:
      // - RTL line ends at x=0 and extends left.
      // - LTR line starts at x=0 and extends right.
      lineGroup.position.set(isRtlParagraph ? -cursorX : 0, baselineY, 0)
      root.add(lineGroup)

      addLineGuide(
        root,
        baselineY,
        isRtlParagraph ? -cursorX : 0,
        isRtlParagraph ? 0 : cursorX
      )

      diagnosticsLines.push({
        lineIndex,
        source: lineSource,
        requestedBaseDirection: baseDirection,
        effectiveTextBoxDirection: effectiveBaseDirection,
        resolvedBaseLevel: bidiLine.baseLevel,
        resolvedParagraphDirection: isRtlParagraph ? 'rtl' : 'ltr',
        levels: Array.from(bidiLine.embedding.levels),
        reorderedIndices: bidiLine.reorderedIndices,
        logicalRuns: bidiLine.logicalRuns.map(run => ({
          logicalRange: [run.start, run.end],
          level: run.level,
          direction: run.direction,
          source: run.source
        })),
        visualRuns: runDiagnostics,
        lineAdvanceWidth: cursorX
      })
    })

    const guideTop = lineAdvance * 0.75
    const guideBottom = -(Math.max(1, sourceLines.length) - 0.25) * lineAdvance
    addAnchorGuide(root, guideTop, guideBottom)

    scene.add(root)
    renderedGroup = root
    fitCamera(root)

    setStatus(
      `Success: ${sourceLines.length} line(s), ${totalGlyphs} shaped glyphs, ` +
        `${totalVisibleMeshes} visible meshes. Direction: ` +
        `${baseDirection === 'auto' ? `Auto→${effectiveBaseDirection.toUpperCase()}` : effectiveBaseDirection.toUpperCase()}.`
    )

    diagnostics.textContent = JSON.stringify(
      {
        unicodeText: text,
        requestedBaseDirection: baseDirection,
        effectiveTextBoxDirection: effectiveBaseDirection,
        fontFile: fontInput.files?.[0]?.name ?? null,
        upem: face.upem,
        bidiEngine: 'bidi-js 1.1.0',
        shapingEngine: 'HarfBuzzJS 1.6.2',
        lines: diagnosticsLines
      },
      null,
      2
    )
  } catch (error) {
    console.error('[Arabic BiDi POC]', error)
    const message = error instanceof Error ? error.message : String(error)
    setStatus(`POC failed: ${message}`, true)
    diagnostics.textContent =
      error instanceof Error ? error.stack ?? message : message
  } finally {
    renderButton.disabled = false
  }
}

fontInput.addEventListener('change', async () => {
  const file = fontInput.files?.[0]
  if (!file) {
    selectedFontBytes = null
    setStatus('Choose an Arabic-capable TTF/OTF font first.')
    return
  }

  try {
    selectedFontBytes = await file.arrayBuffer()
    await loadHarfBuzz()
    setStatus(`Ready: ${file.name}. Click BiDi + Shape + Render.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setStatus(`Failed to initialize HarfBuzz: ${message}`, true)
    diagnostics.textContent =
      error instanceof Error ? error.stack ?? message : message
  }
})

renderButton.addEventListener('click', () => {
  void bidiShapeAndRender()
})

directionInput.addEventListener('change', () => {
  if (selectedFontBytes) {
    void bidiShapeAndRender()
  }
})

document.querySelectorAll<HTMLButtonElement>('[data-text]').forEach(button => {
  button.addEventListener('click', () => {
    textInput.value = button.dataset.text ?? ''
    if (selectedFontBytes) {
      void bidiShapeAndRender()
    }
  })
})

window.addEventListener('resize', resize)
resize()

renderer.setAnimationLoop(() => {
  controls.update()
  renderer.render(scene, camera)
})

void loadHarfBuzz()
  .then(() => {
    setStatus('HarfBuzz runtime ready. Choose an Arabic TTF/OTF font.')
  })
  .catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    setStatus(`HarfBuzz runtime failed: ${message}`, true)
    diagnostics.textContent =
      error instanceof Error ? error.stack ?? message : message
  })

