export function getBackendUrl(): string {
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
    return process.env.NEXT_PUBLIC_BACKEND_URL || `${protocol}//${hostname}:5001`
  }
  return process.env.BACKEND_URL || 'http://127.0.0.1:5001'
}
