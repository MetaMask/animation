import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import { MetamaskBoxAnimation } from './src/MetamaskBoxAnimation'

const container = document.getElementById('react-container')
if (container) {
  const root = ReactDOM.createRoot(container)
  root.render(
    <MetamaskBoxAnimation
      phi={0}
      theta={Math.PI / 2}
      distance={800}
      hemisphereAxis={[0.1, 0.5, 0.2]}
      hemisphereColor1={[1, 1, 1]}
      hemisphereColor0={[1, 1, 1]}
      fogColor={[0.5, 0.5, 0.5]}
      interiorColor0={[1, 0.5, 0]}
      interiorColor1={[0.5, 0.2, 0]}
      noGLFallback={<div>WebGL not supported :(</div>}
      enableZoom={false}
      followMouse={false}
    />
  )
}
