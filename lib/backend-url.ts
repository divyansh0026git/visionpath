export function getBackendUrl(): string {
  if (typeof window !== 'undefined') {
    return process.env.NEXT_PUBLIC_BACKEND_URL || `http://${window.location.hostname}:5001`
  }
  return process.env.BACKEND_URL || 'http://127.0.0.1:5001'
}
