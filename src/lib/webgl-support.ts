// Detects whether the browser will give us a WebGL context at all. Privacy hardening
// (e.g. Brave Shields with fingerprinting protection on "Strict") makes getContext()
// return null, which would otherwise leave the three.js canvas silently blank white.
export function webglSupported(): boolean {
  if (typeof document === "undefined") return true;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    return gl !== null;
  } catch {
    return false;
  }
}
