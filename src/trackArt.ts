import { lerp, right } from './sim/math';
import type { Track } from './sim/track';

// Draw a static world into 1024 px camera-local Canvas textures. Unlike one
// giant Phaser.Graphics path, only visible tiles are uploaded / drawn, and
// none of the road geometry is rebuilt on every animation frame.
export const TILE_SIZE = 1024;

export function drawTrackTile(ctx: CanvasRenderingContext2D, track: Track, ppm: number, tileX: number, tileY: number): void {
  const x0 = tileX * TILE_SIZE, y0 = tileY * TILE_SIZE;
  ctx.save();
  ctx.translate(-x0, -y0);
  ctx.fillStyle = '#12242c';
  ctx.fillRect(x0, y0, TILE_SIZE, TILE_SIZE);
  ctx.strokeStyle = '#274048';
  ctx.globalAlpha = .35;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.floor(x0 / ppm / 10) * 10; x < (x0 + TILE_SIZE) / ppm; x += 10) {
    ctx.moveTo(x * ppm, y0); ctx.lineTo(x * ppm, y0 + TILE_SIZE);
  }
  for (let y = Math.floor(y0 / ppm / 10) * 10; y < (y0 + TILE_SIZE) / ppm; y += 10) {
    ctx.moveTo(x0, y * ppm); ctx.lineTo(x0 + TILE_SIZE, y * ppm);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  const buildings = track.config.id === 'oval'
    ? [[101, 63, 34, 20], [151, 65, 28, 26], [130, 80, 20, 12]]
    : track.config.id === 'drag_strip' ? [[85, 96, 22, 15], [275, 99, 32, 11], [220, 155, 20, 9]]
      : [[65, 72, 31, 19], [125, 71, 30, 23], [192, 142, 25, 12], [56, 145, 19, 9], [155, 68, 16, 10]];
  for (const [x, y, w, h] of buildings) {
    if ((x + w + 5) * ppm < x0 || (y + h + 6) * ppm < y0 || x * ppm > x0 + TILE_SIZE || y * ppm > y0 + TILE_SIZE) continue;
    ctx.fillStyle = '#030a1390'; ctx.fillRect((x + 3) * ppm, (y + 4) * ppm, w * ppm, h * ppm);
    ctx.fillStyle = '#152632'; ctx.fillRect(x * ppm, y * ppm, w * ppm, h * ppm);
    ctx.strokeStyle = '#466371'; ctx.lineWidth = 3; ctx.strokeRect(x * ppm, y * ppm, w * ppm, h * ppm);
    ctx.strokeStyle = '#00e5ff80'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo((x + 1) * ppm, (y + 1) * ppm); ctx.lineTo((x + w - 1) * ppm, (y + 1) * ppm); ctx.stroke();
    ctx.fillStyle = '#2a4757';
    for (let i = 0; i < 4; i++) ctx.fillRect((x + 3 + i * 5) * ppm, (y + h * .38) * ppm, 3 * ppm, 2.5 * ppm);
    ctx.strokeStyle = '#ff2e9760'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo((x + 2) * ppm, (y + h - 2) * ppm); ctx.lineTo((x + w - 2) * ppm, (y + h - 2) * ppm); ctx.stroke();
  }
  const b = track.bounds;
  for (let i = 0; i < 40; i++) {
    const x = b.minX + ((i * 71.37) % (b.maxX - b.minX));
    const y = b.minY + ((i * 43.73) % (b.maxY - b.minY));
    if (x * ppm < x0 - 20 || x * ppm > x0 + TILE_SIZE + 20 || y * ppm < y0 - 20 || y * ppm > y0 + TILE_SIZE + 20) continue;
    if (track.nearest({ x, y }).distance < track.config.roadWidth) continue;
    const color = i % 4 ? '#00e5ff' : '#ff2e97';
    ctx.globalAlpha = .13; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x * ppm, y * ppm, 17, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = .65; ctx.beginPath(); ctx.arc(x * ppm, y * ppm, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  const line = (width: number, color: string, opacity = 1) => {
    ctx.lineWidth = width * ppm; ctx.strokeStyle = color; ctx.globalAlpha = opacity;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
    track.points.forEach((p, i) => i ? ctx.lineTo(p.x * ppm, p.y * ppm) : ctx.moveTo(p.x * ppm, p.y * ppm));
    ctx.closePath(); ctx.stroke(); ctx.globalAlpha = 1;
  };
  line(track.config.roadWidth + 2, '#07111d');
  line(track.config.roadWidth + .5, '#8ab8bd', .75);
  line(track.config.roadWidth, '#27343f');
  line(track.config.roadWidth * .68, '#2c3d47', .53);
  for (const patch of track.config.patches) {
    if ((patch.x + patch.rx) * ppm < x0 || (patch.x - patch.rx) * ppm > x0 + TILE_SIZE || (patch.y + patch.ry) * ppm < y0 || (patch.y - patch.ry) * ppm > y0 + TILE_SIZE) continue;
    ctx.fillStyle = { wet: '#15516bc4', dirt: '#715b3ec4', oil: '#090d13ef', grass: '#254c34', asphalt: '#27343f' }[patch.surface];
    ctx.beginPath(); ctx.ellipse(patch.x * ppm, patch.y * ppm, patch.rx * ppm, patch.ry * ppm, 0, 0, Math.PI * 2); ctx.fill();
    if (patch.surface === 'oil') { ctx.strokeStyle = '#e447ad9a'; ctx.lineWidth = 2; ctx.stroke(); }
  }
  // Redraw actual edge polylines ON TOP of patches: road boundaries stay legible
  // in wet / dirt / oil sections, even at top speed and on Low quality.
  ctx.lineWidth = 3.5;
  for (const side of [-1, 1]) {
    ctx.strokeStyle = side > 0 ? '#ff2e9766' : '#00e5ff77';
    ctx.beginPath();
    track.points.forEach((p, i) => {
      const next = track.points[(i + 1) % track.points.length];
      const dir = Math.atan2(next.y - p.y, next.x - p.x), n = right(dir);
      const ex = (p.x + n.x * side * track.config.roadWidth / 2) * ppm;
      const ey = (p.y + n.y * side * track.config.roadWidth / 2) * ppm;
      if (i) ctx.lineTo(ex, ey); else ctx.moveTo(ex, ey);
    });
    ctx.closePath(); ctx.stroke();
  }
  ctx.lineWidth = 2;
  for (let s = 0; s < track.length; s += 9) {
    const a = track.at(s), b = track.at(s + 3);
    if (a.point.x * ppm < x0 - 40 || a.point.x * ppm > x0 + TILE_SIZE + 40 || a.point.y * ppm < y0 - 40 || a.point.y * ppm > y0 + TILE_SIZE + 40) continue;
    ctx.strokeStyle = '#c9d7d980'; ctx.beginPath(); ctx.moveTo(a.point.x * ppm, a.point.y * ppm); ctx.lineTo(b.point.x * ppm, b.point.y * ppm); ctx.stroke();
    const dir = right(a.heading), edge = track.config.roadWidth / 2 + .15;
    for (const side of [-1, 1]) {
      ctx.fillStyle = side > 0 ? '#ff2e97' : '#00e5ff';
      ctx.globalAlpha = .8;
      ctx.beginPath(); ctx.arc((a.point.x + dir.x * side * edge) * ppm, (a.point.y + dir.y * side * edge) * ppm, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const start = track.config.start;
  const heading = track.nearest(start).heading, normal = right(heading);
  for (let stripe = -4; stripe <= 4; stripe++) {
    const px = (start.x + normal.x * stripe * 1.3) * ppm, py = (start.y + normal.y * stripe * 1.3) * ppm;
    ctx.fillStyle = stripe % 2 === 0 ? '#d9edf5c9' : '#071725c9';
    ctx.fillRect(px - 11, py - 11, 22, 22);
  }
  for (const [ax, ay, bx, by] of track.config.barriers) {
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#08121d'; ctx.lineWidth = 1.1 * ppm;
    ctx.beginPath(); ctx.moveTo(ax * ppm, ay * ppm); ctx.lineTo(bx * ppm, by * ppm); ctx.stroke();
    ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = .56 * ppm;
    ctx.beginPath(); ctx.moveTo(ax * ppm, ay * ppm); ctx.lineTo(bx * ppm, by * ppm); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i <= 5; i++) { ctx.beginPath(); ctx.arc(lerp(ax, bx, i / 5) * ppm, lerp(ay, by, i / 5) * ppm, 3, 0, Math.PI * 2); ctx.fill(); }
  }
  // Quiet perimeter fence matches the physical containment walls. It is far
  // outside the asphalt, so drivers can still explore off-road patches.
  ctx.strokeStyle = '#42687d99'; ctx.lineWidth = 4;
  ctx.setLineDash([12, 9]);
  ctx.strokeRect(track.bounds.minX * ppm, track.bounds.minY * ppm, (track.bounds.maxX - track.bounds.minX) * ppm, (track.bounds.maxY - track.bounds.minY) * ppm);
  ctx.setLineDash([]);
  ctx.restore();
}
