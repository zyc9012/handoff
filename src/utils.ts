export const MAX_ROOM_CODE_LENGTH = 16

export function normalizeRoomCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, MAX_ROOM_CODE_LENGTH)
}

export function isNearbyPath(pathname: string): boolean {
  return pathname === '/drop' || pathname.startsWith('/drop/')
}

export function roomCodeFromPath(pathname: string): string {
  if (!pathname.startsWith('/drop/')) return ''

  const segment = pathname.slice('/drop/'.length).split('/')[0]
  try {
    return normalizeRoomCode(decodeURIComponent(segment))
  } catch {
    return normalizeRoomCode(segment)
  }
}