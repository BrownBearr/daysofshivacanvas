// The canvas runs `frameloop="demand"`: nothing renders unless something asks. Async work outside
// the frame loop (poster arrival, video frames, input, store changes) calls requestFrame().
let request: () => void = () => {};

export function setFrameRequester(fn: () => void): void {
  request = fn;
}

export function requestFrame(): void {
  request();
}
