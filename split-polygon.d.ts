declare module 'split-polygon' {
    export const positive: (verts:number[][], plane:number[]) => number[][]
    export const negative: (verts:number[][], plane:number[]) => number[][]
}
