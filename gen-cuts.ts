//eriknson

import { FOX } from './fox-model'
import * as splitPolygon from 'split-polygon'
import * as cdtd2 from 'cdt2d'
import * as raycastTri from 'watertight-ray-triangle-intersection'
import { mat3, vec3 } from 'gl-matrix'

// size of boxes to chop fox into
const CUBE_DIAMETER = 24

// fox precision
const FOX_PRECISION = 6

// crack welding distance to clean up clipped geometry
const EPSILON = 1 / 256

// a single polygon in the fox
type Polygon = {
  verts: number[][]
  material: number
  indices?: number[]
}

// a material table entry from the parsed fox mesh
type Material = {
  color: number[]
}

// output mesh
type PackedBoxMesh = {
  // cube diameter
  diameter: number

  // bounding box (3)
  lo: number[]
  hi: number[]

  // grid bounds
  gridLo: number[]
  gridHi: number[]

  // boundary direction
  boundary: number[][]

  // material table (numMaterials x 3)
  colors: number[][]

  // vertex table (numVerts x 3)
  verts: number[][]

  // box centers table (numBoxes x 3)
  centers: number[][] // center of each box

  // box table
  //  (numBoxes x numBoxMaterials x numBoxPolygons)
  // table is grouped first by
  //      1. box id
  //      2. material id
  //      3. polygon list
  //      4. polygon vertex id
  boxes: [number, number[][]][][]
}

// internal data structure for all fox polygones clipped to a fixed box
type FoxBox = {
  index: number[]
  polys: Polygon[]
  boundaryDir: vec3
}

// first read in the fox mesh and compute bounds/materials
const foxLo: number[] = [Infinity, Infinity, Infinity]
const foxHi: number[] = [-Infinity, -Infinity, -Infinity]
const foxPolys: Polygon[] = []
const foxMaterials: Material[] = []
FOX.chunks.forEach((c, material) => {
  foxMaterials.push({
    color: c.color,
  })
  c.faces.forEach((f) => {
    foxPolys.push({
      verts: f.map((i) => {
        const pos = FOX.positions[i].slice()
        for (let j = 0; j < 3; ++j) {
          foxLo[j] = Math.min(foxLo[j], pos[j])
          foxHi[j] = Math.max(foxHi[j], pos[j])
        }
        return pos
      }),
      material,
    })
  })
})

// add about 20 different reddish color materials for the fox mystery filling :-)
const INTERIOR_MATERIAL = foxMaterials.length
foxMaterials.push({
  color: [255, 255, 255],
})

// snap-round fox vertices together to remove cracks and fill interior faces
const FOX_VERTS: number[][] = []
const VERTEX_INDEX = new Map<string, number>()

// returns deduplicated/snap rounded index of a given vertex in the output vertex table
function lookupVertex(v: number[]) {
  let key: string = ''
  for (let i = 0; i < 3; ++i) {
    key += Math.round(v[i] / EPSILON) + ','
  }
  const entry = VERTEX_INDEX.get(key)
  if (typeof entry !== 'undefined') {
    return entry
  }
  const id = FOX_VERTS.length
  VERTEX_INDEX.set(key, id)
  FOX_VERTS.push(v.map((x) => +x.toPrecision(FOX_PRECISION)))
  return id
}

// quick hack to classify points against fox mesh
const tmp = vec3.create()
function testRayPolygon(origin: number[], direction: number[], poly: Polygon) {
  const { verts } = poly
  const a = verts[0]
  tmp[0] = tmp[1] = tmp[2] = 0
  for (let i = 1; i + 1 < verts.length; ++i) {
    if (raycastTri(tmp, origin, direction, [a, verts[i], verts[i + 1]])) {
      vec3.sub(tmp, tmp, origin as vec3)
      return +(vec3.dot(tmp, direction as vec3) > 0)
    }
  }
  return 0
}
function testPointInFox(d: number[]) {
  let inside = 0
  for (const poly of foxPolys) {
    inside ^= testRayPolygon(d, [1, 1, 1], poly)
  }
  return !!inside
}

function orient2d(a: number[], b: number[], c: number[]) {
  return mat3.determinant(
    mat3.fromValues(a[0], a[1], 1, b[0], b[1], 1, c[0], c[1], 1)
  )
}

// triangulates one of the interior faces of a fox box
function triangulateInteriorFace(
  index: number[],
  polys: Polygon[],
  u: number,
  v: number,
  d: number,
  level: number
) {
  // first pass: find all edges which are coincident with the boundary plane of the face
  const verts: number[][] = []
  const edges: number[][] = []

  function pushVertex(x: number, y: number) {
    for (let i = 0; i < verts.length; ++i) {
      if (
        Math.max(Math.abs(verts[i][0] - x), Math.abs(verts[i][1] - y)) < EPSILON
      ) {
        return i
      }
    }
    const n = verts.length
    verts.push([x, y])
    return n
  }

  function pushEdge(v0: number[], v1: number[]) {
    const i0 = pushVertex(v0[0], v0[1])
    const i1 = pushVertex(v1[0], v1[1])

    const a = Math.min(i0, i1)
    const b = Math.max(i0, i1)
    for (let i = 0; i < edges.length; ++i) {
      const [c, d] = edges[i]
      if (a === Math.min(c, d) && b === Math.max(c, d)) {
        return
      }
    }
    edges.push([i0, i1])
  }

  for (const poly of polys) {
    const verts = poly.verts
    for (let i = 0; i < verts.length; ++i) {
      const a = verts[i]
      const b = verts[(i + 1) % verts.length]
      if (a[d] === level && b[d] === level) {
        pushEdge([a[u], a[v]], [b[u], b[v]])
      }
    }
  }

  // add the 4 corners of the box to the pslg
  for (let i = 0; i < 2; ++i) {
    for (let j = 0; j < 2; ++j) {
      const p = [0, 0, 0]
      p[u] = CUBE_DIAMETER * (index[u] + i)
      p[v] = CUBE_DIAMETER * (index[v] + j)
      p[d] = level
      if (testPointInFox(p)) {
        pushVertex(p[u], p[v])
      }
    }
  }

  // triangulate the pslg of the coplanar faces
  return cdtd2(verts, edges, { delaunay: true })
    .map((t) => {
      const a = verts[t[0]]
      const b = verts[t[1]]
      const c = verts[t[2]]

      if (orient2d(a, b, c) < 0) {
        const tmp = t[1]
        t[1] = t[2]
        t[2] = tmp
      }

      return t.map((i) => {
        // for each triangle in pslg, deindex it and recover the original embedding
        const p = verts[i]
        const result = [0, 0, 0]
        result[u] = p[0]
        result[v] = p[1]
        result[d] = level
        return result
      })
    })
    .filter(([A, B, C]) => {
      // finally: filter out triangles whose centroid is not contained in the original fox mesh
      const x = [0, 0, 0]
      for (let i = 0; i < 3; ++i) {
        x[i] = (A[i] + B[i] + C[i]) / 3
      }
      return testPointInFox(x)
    })
}

// compute the bounds of the box grid
const GRID_LO = [0, 0, 0]
const GRID_HI = [0, 0, 0]
for (let i = 0; i < 3; ++i) {
  GRID_LO[i] = Math.floor(foxLo[i] / CUBE_DIAMETER)
  GRID_HI[i] = Math.ceil(foxHi[i] / CUBE_DIAMETER)
}

function rotateArray<T>(x: T[], shift: number) {
  return x.map((_, i) => x[(i + shift) % x.length])
}

// clips the fox mesh to a box
function clipToBox(index: number[]): FoxBox {
  // first clip fox vertices to cube bounds
  const planes: number[][] = []
  for (let i = 0; i < 3; ++i) {
    const x = index[i] * CUBE_DIAMETER
    const a = [0, 0, 0, x]
    const b = [0, 0, 0, -(x + CUBE_DIAMETER)]
    a[i] = -1
    b[i] = 1
    planes.push(a, b)
  }
  const polys: Polygon[] = []
  foxPolys.forEach((p) => {
    let verts = p.verts
    for (let i = 0; i < planes.length; ++i) {
      verts = splitPolygon.negative(verts, planes[i])
      if (verts.length < 3) {
        return
      }
      // snap face vertices to cube grid
      verts.forEach((vertex: number[]) => {
        for (let i = 0; i < 3; ++i) {
          const t = Math.round(vertex[i] / CUBE_DIAMETER) * CUBE_DIAMETER
          if (Math.abs(t - vertex[i]) < EPSILON) {
            vertex[i] = t
          }
        }
      })
    }
    const indices = verts.map(lookupVertex)
    polys.push({
      verts: indices.map((index) => FOX_VERTS[index]),
      material: p.material,
      indices,
    })
  })

  // calculate boundary normal
  const boundaryDir = vec3.create()
  polys.forEach((p) => {
    for (let i = 2; i < p.verts.length; ++i) {
      const a: any = p.verts[0]
      const b: any = p.verts[i]
      const c: any = p.verts[i - 1]
      const ab = vec3.sub(vec3.create(), b, a)
      const ac = vec3.sub(vec3.create(), c, a)
      const abxac = vec3.cross(vec3.create(), ab, ac)
      vec3.add(boundaryDir, boundaryDir, abxac)
    }
  })
  vec3.normalize(boundaryDir, boundaryDir)

  // then add interior faces using randomized material
  const material = INTERIOR_MATERIAL
  for (let d = 0; d < 3; ++d) {
    for (let s = -1; s <= 1; s += 2) {
      triangulateInteriorFace(
        index,
        polys,
        (d + s + 3) % 3,
        (d - s + 3) % 3,
        d,
        CUBE_DIAMETER * (Math.max(s, 0) + index[d])
      ).forEach((verts: number[][]) => {
        const indices = verts.map(lookupVertex)
        polys.push({
          material,
          indices,
          verts: indices.map((v) => FOX_VERTS[v].slice()),
        })
      })
    }
  }

  return {
    index,
    polys: polys.map((poly) => {
      const p = poly.indices
      if (!p) {
        return poly
      }
      let minIndex = 0
      for (let i = 1; i < p.length; ++i) {
        if (p[i] < p[minIndex]) {
          minIndex = i
        }
      }
      poly.indices = rotateArray(p, minIndex)
      poly.verts = rotateArray(poly.verts, minIndex)
      return poly
    }),
    boundaryDir,
  }
}

// loop over every grid cell and clip fox faces to box
const BOXES = new Map<string, FoxBox>()
for (let i = GRID_LO[0] - 1; i <= GRID_HI[0] + 1; ++i) {
  for (let j = GRID_LO[1] - 1; j <= GRID_HI[1] + 1; ++j) {
    for (let k = GRID_LO[2] - 1; k <= GRID_HI[2] + 1; ++k) {
      const index = [i, j, k]
      BOXES.set(index.join(), clipToBox(index))
    }
  }
}

// finally, pack all of the boxes into a serializable mesh object
const nonEmptyBoxes = Array.from(BOXES.values()).filter(
  (b) => b.polys.length > 0
)
const mesh: PackedBoxMesh = {
  diameter: CUBE_DIAMETER,
  lo: foxLo,
  hi: foxHi,
  gridLo: GRID_LO,
  gridHi: GRID_HI,
  boundary: nonEmptyBoxes.map((b) => Array.from(b.boundaryDir)),
  colors: foxMaterials.map((c) => c.color.map((v) => v >>> 0)),
  verts: FOX_VERTS.map((v) => v.map((x) => +x.toFixed(6))),
  centers: nonEmptyBoxes.map((box) =>
    box.index.map((c) => CUBE_DIAMETER * (c + 0.5))
  ),
  boxes: nonEmptyBoxes.map((box) => {
    const materialGroups = new Map<number, number[][]>()
    box.polys.forEach((p) => {
      const indices = p.indices
      if (!indices) {
        return
      }
      let c = materialGroups.get(p.material)
      if (!c) {
        c = []
        materialGroups.set(p.material, c)
      }
      c.push(indices)
    })

    // form triangle fans from the index set
    // for (const [materialID, basePolys] of materialGroups.entries()) {
    //     const polys = basePolys.filter((p) => p.length > 3)
    //     const tris = basePolys.filter((p) => p.length === 3)
    //     tris.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]))
    //     // fuse triangles into fans
    //     const fans:number[][] = []
    //     while (tris.length > 0) {
    //         const tri = tris.shift()
    //         if (!tri) {
    //             break
    //         }
    //         const fan:number[] = tri.slice()
    //         fans.push(fan)
    //         while (true) {
    //             const next = tris.findIndex((p) =>
    //                 p[0] === fan[0] &&
    //                 p[1] === fan[fan.length - 1]
    //             )
    //             if (next < 0) {
    //                 break
    //             }
    //             fan.push(tris[next][2])
    //             tris.splice(next, 1)
    //         }
    //     }
    //     materialGroups.set(materialID, polys.concat(fans))
    // }
    return Array.from(materialGroups.entries())
  }),
}

// print mesh
const FOX_DATA_STR = `export const FOX_BOXES:{
    diameter:number
    lo: number[]
    hi: number[]
    gridLo: number[]
    gridHi: number[]
    boundary: number[][]
    colors: number[][]
    verts:number[][]
    centers: number[][]
    boxes: [number, number[][]][][]
} = JSON.parse(
'${JSON.stringify(mesh)}'
)`
console.log(FOX_DATA_STR)

// log standard diagnostics
console.error(`packed mesh is ${FOX_DATA_STR.length} bytes (${(
  FOX_DATA_STR.length / 1024
).toFixed(2)} kb).
diameter   = ${CUBE_DIAMETER}
grid dims  = ${GRID_LO.map((l, i) => GRID_HI[i] - l).join(' x ')}
box  count = ${nonEmptyBoxes.length}
vert count = ${FOX_VERTS.length}
tri  count = ${nonEmptyBoxes
  .map((box) =>
    box.polys.map((p) => p.verts.length - 2).reduce((a, b) => a + b)
  )
  .reduce((a, b) => a + b)}`)
