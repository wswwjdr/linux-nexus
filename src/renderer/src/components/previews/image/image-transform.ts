export interface Size { width: number; height: number }
export interface Point { x: number; y: number }

export function imageFitScale(image: Size, viewport: Size, rotation: number): number {
  const sideways = Math.abs(rotation % 180) === 90
  const width = sideways ? image.height : image.width
  const height = sideways ? image.width : image.height
  return Math.min(1, viewport.width / width, viewport.height / height)
}

export function zoomAt(zoom: number, next: number, pan: Point, anchor: Point): { zoom: number; pan: Point } {
  const clamped = Math.max(.1, Math.min(10, next))
  const ratio = clamped / zoom
  return { zoom: clamped, pan: { x: anchor.x - (anchor.x - pan.x) * ratio, y: anchor.y - (anchor.y - pan.y) * ratio } }
}
