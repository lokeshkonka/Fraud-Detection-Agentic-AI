// ---------------------------------------------------------------------------
// usePresentation — returns true when ?presentation=1 is in the URL.
// Used to stabilise graph physics and freeze live timestamps for screenshots.
// ---------------------------------------------------------------------------

export function usePresentation(): boolean {
  return new URLSearchParams(window.location.search).get('presentation') === '1'
}
