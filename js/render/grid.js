import { state, canvas, ctx } from '../core/state.js';
import { getScale, metersToScreen, screenToMeters } from '../core/transforms.js';

export function drawGrid() {
  const ppm = getScale() * state.zoom;
  if (ppm < 1) return;

  // Determine grid spacing in meters based on zoom
  let gridSpacing = 1;
  if (ppm < 3) gridSpacing = 50;
  else if (ppm < 8) gridSpacing = 20;
  else if (ppm < 15) gridSpacing = 10;
  else if (ppm < 40) gridSpacing = 5;
  else gridSpacing = 1;

  const topLeft = screenToMeters(0, 0);
  const bottomRight = screenToMeters(canvas.width, canvas.height);

  const startX = Math.floor(topLeft.x / gridSpacing) * gridSpacing;
  const startY = Math.floor(topLeft.y / gridSpacing) * gridSpacing;

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.5;

  for (let x = startX; x <= bottomRight.x; x += gridSpacing) {
    const s1 = metersToScreen(x, topLeft.y);
    const s2 = metersToScreen(x, bottomRight.y);
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();
  }
  for (let y = startY; y <= bottomRight.y; y += gridSpacing) {
    const s1 = metersToScreen(topLeft.x, y);
    const s2 = metersToScreen(bottomRight.x, y);
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();
  }

  // Origin crosshair
  const origin = metersToScreen(0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(origin.x, 0);
  ctx.lineTo(origin.x, canvas.height);
  ctx.moveTo(0, origin.y);
  ctx.lineTo(canvas.width, origin.y);
  ctx.stroke();
}
