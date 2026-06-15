"use client"

import { useState } from "react"
import { DotOrbit, MeshGradient } from "@paper-design/shaders-react"

export default function ShaderDemo() {
  const [intensity] = useState(1.5)
  const [speed] = useState(1)
  const [activeEffect] = useState<"mesh" | "dots" | "combined">("mesh")
  const [copied, setCopied] = useState(false)

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText("npm install @paper-design/shaders-react three @react-three/fiber")
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black">
      {activeEffect === "mesh" && (
        <MeshGradient
          className="absolute inset-0 h-full w-full"
          colors={["#000000", "#1a1a1a", "#333333", "#ffffff"]}
          speed={speed}
          backgroundColor="#000000"
        />
      )}

      {activeEffect === "dots" && (
        <div className="absolute inset-0 h-full w-full bg-black">
          <DotOrbit className="h-full w-full" dotColor="#333333" orbitColor="#1a1a1a" speed={speed} intensity={intensity} />
        </div>
      )}

      {activeEffect === "combined" && (
        <>
          <MeshGradient
            className="absolute inset-0 h-full w-full"
            colors={["#000000", "#1a1a1a", "#333333", "#ffffff"]}
            speed={speed * 0.5}
            wireframe="true"
            backgroundColor="#000000"
          />
          <div className="absolute inset-0 h-full w-full opacity-60">
            <DotOrbit className="h-full w-full" dotColor="#333333" orbitColor="#1a1a1a" speed={speed * 1.5} intensity={intensity * 0.8} />
          </div>
        </>
      )}

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="text-center font-mono text-xs text-white/40">
          <div>shader background example</div>
          <div className="mt-1 flex items-center gap-2">
            <span>npm install @paper-design/shaders-react</span>
            <button
              onClick={copyToClipboard}
              className="pointer-events-auto text-white/60 opacity-40 transition-opacity hover:text-white/80 hover:opacity-70"
              title="Copy install command"
              type="button"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

