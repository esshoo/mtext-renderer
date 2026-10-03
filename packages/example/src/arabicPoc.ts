import type * as HarfBuzzTypes from 'harfbuzzjs'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

type HarfBuzzApi = typeof HarfBuzzTypes
type HbGlyph = ReturnType<HarfBuzzTypes.Buffer['getGlyphInfosAndPositions']>[number]

interface ShapedLineDiagnostics {
  lineIndex: number
  source: string
  glyphCount: number
  glyphs: Array<{
    glyphId: number
    glyphName: string
    cluster: number
    xAdvance: number
    yAdvance: number
    xOffset: number
    yOffset: number
  }>
}

const view = document.getElementById('view') as HTMLElement
const fontInput = document.getElementById('font') as HTMLInputElement
const textInput = document.getElementById('text') as HTMLTextAreaElement
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
        const lineMaterial = object.material
        if (Array.isArray(lineMaterial)) {
          lineMaterial.forEach(material => material.dispose())
        } else {
          lineMaterial.dispose()
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

  const shapes = glyphCommandsToShapes(commands)
  for (const shape of shapes) {
    const geometry = new THREE.ShapeGeometry(shape, 6)
    if (geometry.getAttribute('position')?.count === 0) {
      geometry.dispose()
      continue
    }

    const mesh = new THREE.Mesh(geometry, renderedMaterial!)
    glyphRoot.add(mesh)
  }

  return glyphRoot
}

function addBaseline(
  root: THREE.Group,
  y: number,
  minX: number,
  maxX: number
): void {
  const safeMin = Number.isFinite(minX) ? minX : 0
  const safeMax = Number.isFinite(maxX) ? maxX : 0

  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(safeMin, y, -1),
    new THREE.Vector3(safeMax, y, -1)
  ])
  const material = new THREE.LineBasicMaterial({ color: 0x334155 })
  const line = new THREE.Line(geometry, material)
  line.userData.pocHelper = true
  root.add(line)
}

function fitCamera(object: THREE.Object3D): void {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)

  if (box.isEmpty()) {
    setStatus('Shaping succeeded, but no visible glyph geometry was produced.', true)
    return
  }

  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())

  const viewportWidth = Math.max(1, view.clientWidth)
  const viewportHeight = Math.max(1, view.clientHeight)
  const aspect = viewportWidth / viewportHeight

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

function codePointCount(value: string): number {
  return Array.from(value).length
}

function normalizeSourceLines(text: string): string[] {
  // Newlines are layout separators, not characters that should be shaped.
  // Keep empty lines so vertical structure is preserved.
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function resolveLineAdvance(font: HarfBuzzTypes.Font, upem: number): number {
  const extents = font.hExtents()
  const typographic =
    Math.abs(extents.ascender - extents.descender) + Math.max(0, extents.lineGap)

  // Use a stable fallback if a font exposes unusual/empty metrics.
  return Math.max(upem * 1.25, typographic * 1.1)
}

function shapeOneLine(
  hb: HarfBuzzApi,
  font: HarfBuzzTypes.Font,
  source: string
): HbGlyph[] {
  if (source.length === 0) {
    return []
  }

  const buffer = new hb.Buffer()
  buffer.addText(source)
  buffer.guessSegmentProperties()
  hb.shape(font, buffer)
  return buffer.getGlyphInfosAndPositions()
}

function appendShapedLine(
  root: THREE.Group,
  font: HarfBuzzTypes.Font,
  glyphs: HbGlyph[],
  baselineY: number
): number {
  let penX = 0
  let penY = baselineY
  let visibleGlyphMeshes = 0
  let minX = 0
  let maxX = 0

  for (const glyph of glyphs) {
    const glyphObject = createGlyphObject(font, glyph.codepoint)
    const glyphX = penX + (glyph.xOffset ?? 0)
    const glyphY = penY + (glyph.yOffset ?? 0)

    glyphObject.position.set(glyphX, glyphY, 0)
    visibleGlyphMeshes += glyphObject.children.length
    root.add(glyphObject)

    minX = Math.min(minX, glyphX)
    maxX = Math.max(maxX, glyphX)

    penX += glyph.xAdvance ?? 0
    penY += glyph.yAdvance ?? 0

    minX = Math.min(minX, penX)
    maxX = Math.max(maxX, penX)
  }

  addBaseline(root, baselineY, minX, maxX)
  return visibleGlyphMeshes
}

async function shapeAndRender(): Promise<void> {
  if (!selectedFontBytes) {
    setStatus('Choose a TTF/OTF font first.', true)
    return
  }

  const text = textInput.value
  if (!text) {
    setStatus('Enter some Unicode text.', true)
    return
  }

  renderButton.disabled = true
  setStatus('Loading HarfBuzz and shaping lines…')
  diagnostics.textContent = ''

  try {
    const hb = await loadHarfBuzz()

    const blob = new hb.Blob(selectedFontBytes.slice(0))
    const face = new hb.Face(blob, 0)
    const font = new hb.Font(face)

    font.setScale(face.upem, face.upem)

    const lines = normalizeSourceLines(text)
    const lineAdvance = resolveLineAdvance(font, face.upem)

    disposeCurrent()

    renderedMaterial = new THREE.MeshBasicMaterial({
      color: 0xf3f5f7,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    })

    const root = new THREE.Group()
    const lineDiagnostics: ShapedLineDiagnostics[] = []
    let totalGlyphCount = 0
    let totalVisibleMeshes = 0

    lines.forEach((lineSource, lineIndex) => {
      const glyphs = shapeOneLine(hb, font, lineSource)
      const baselineY = -lineIndex * lineAdvance

      totalGlyphCount += glyphs.length
      totalVisibleMeshes += appendShapedLine(
        root,
        font,
        glyphs,
        baselineY
      )

      lineDiagnostics.push({
        lineIndex,
        source: lineSource,
        glyphCount: glyphs.length,
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
    })

    scene.add(root)
    renderedGroup = root
    fitCamera(root)

    const inputCount = codePointCount(text)

    setStatus(
      `Success: ${lines.length} line(s), ${inputCount} Unicode code points → ` +
        `${totalGlyphCount} shaped glyphs (${totalVisibleMeshes} visible meshes). ` +
        `Font: ${fontInput.files?.[0]?.name ?? 'local font'}`
    )

    diagnostics.textContent = JSON.stringify(
      {
        unicodeText: text,
        normalizedLines: lines,
        newlinePolicy: 'Newlines are layout separators and are never sent to HarfBuzz.',
        fontFile: fontInput.files?.[0]?.name ?? null,
        upem: face.upem,
        lineAdvance,
        gsubScripts: face.getTableScriptTags('GSUB'),
        gposScripts: face.getTableScriptTags('GPOS'),
        inputCodePoints: Array.from(text).map(char => ({
          char,
          hex: `U+${(char.codePointAt(0) ?? 0)
            .toString(16)
            .toUpperCase()
            .padStart(4, '0')}`
        })),
        totalGlyphCount,
        lines: lineDiagnostics
      },
      null,
      2
    )
  } catch (error) {
    console.error('[Arabic POC]', error)
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
    setStatus(`Loaded ${file.name}. Initializing HarfBuzz…`)

    await loadHarfBuzz()

    setStatus(`HarfBuzz ready. Font loaded: ${file.name}. Click Shape + Render.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setStatus(`Failed to initialize HarfBuzz: ${message}`, true)
    diagnostics.textContent =
      error instanceof Error ? error.stack ?? message : message
  }
})

renderButton.addEventListener('click', () => {
  void shapeAndRender()
})

document.querySelectorAll<HTMLButtonElement>('[data-text]').forEach(button => {
  button.addEventListener('click', () => {
    textInput.value = button.dataset.text ?? ''
    if (selectedFontBytes) {
      void shapeAndRender()
    }
  })
})

window.addEventListener('resize', resize)
resize()

const guideGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-350, 0, 0),
  new THREE.Vector3(350, 0, 0)
])
const guideMaterial = new THREE.LineBasicMaterial({ color: 0x334155 })
scene.add(new THREE.Line(guideGeometry, guideMaterial))

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
