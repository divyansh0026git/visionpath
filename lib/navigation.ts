/**
 * Shared navigation utilities.
 * Single source of truth — used by both page.tsx and spatial-compass.tsx.
 */

export function getCardinalDirection(heading: number): string {
  const directions = [
    "North", "North East", "East", "South East",
    "South", "South West", "West", "North West",
  ]
  const index = Math.round(heading / 45) % 8
  return directions[index]
}
