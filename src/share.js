// WhatsApp share card: draws a 1080x1080 PNG and shares it (Web Share API, else download + wa.me).
const FONT = '"Baloo Chettan 2", system-ui, sans-serif';
const SIGN = '"Bungee", "Baloo Chettan 2", system-ui, sans-serif';
const INK = '#1d1a1b', RED = '#c62828', YELLOW = '#ffcc33';

function loadImage(src) {
  return new Promise((res) => {
    if (!src) return res(null);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

// Signwritten text like the in-game wordmark: ink extrude, then an optional red livery shadow.
function sign(g, text, x, y, face, { depth = 3, step = 3, red = true } = {}) {
  if (red) { g.fillStyle = RED; g.fillText(text, x + (depth + 1) * step, y + (depth + 1) * step); }
  g.fillStyle = INK;
  for (let i = depth; i > 0; i--) g.fillText(text, x + i * step, y + i * step);
  g.fillStyle = face;
  g.fillText(text, x, y);
}

export const distLabel = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(2)} KM`);

// Laid out like a WhatsApp link preview: big photo on top, then a dark band with a rating row, a bold hook,
// one grey line and the domain. Minimal words: the crash photo and the dare do the work.
const STARS = { 'L BOARD': 1, 'POTHOLE PRO': 2, 'KSRTC REGULAR': 3, 'NH66 SURVIVOR': 4, 'NH66 LEGEND': 5 };
export async function makeCard({ m, title, daily, shot, url }) {
  await Promise.all([document.fonts.load(`800 80px ${FONT}`), document.fonts.load(`400 80px ${SIGN}`)]).catch(() => {});
  const W = 1080, H = 1080, PH = 640, X = 56;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.textBaseline = 'middle';

  // The crash photo, full bleed, with a small wordmark badge.
  const img = await loadImage(shot);
  if (img) {
    const s = Math.max(W / img.width, PH / img.height);
    g.drawImage(img, (W - img.width * s) / 2, (PH - img.height * s) / 2, img.width * s, img.height * s);
  } else { g.fillStyle = '#e98a4f'; g.fillRect(0, 0, W, PH); }
  g.font = `400 46px ${SIGN}`;
  const a = 'VANDI-', aw = g.measureText(a).width, bw = g.measureText('VERSE').width;
  g.fillStyle = RED;
  g.beginPath(); g.roundRect(32, 32, aw + bw + 52, 82, 20); g.fill();
  sign(g, a, 56, 72, YELLOW, { red: false, depth: 2, step: 2 });
  sign(g, 'VERSE', 56 + aw, 72, '#fff', { red: false, depth: 2, step: 2 });

  // The preview band.
  g.fillStyle = '#103a30';
  g.fillRect(0, PH, W, H - PH);
  let x = X;
  g.font = `400 62px ${SIGN}`;
  g.fillStyle = '#fff'; g.fillText(distLabel(m), x, 712); x += g.measureText(distLabel(m)).width + 22;
  const n = STARS[title] ?? 1;
  g.font = `800 58px ${FONT}`;
  g.fillStyle = '#f5821f'; g.fillText('★'.repeat(n), x, 712); x += g.measureText('★'.repeat(n)).width;
  g.fillStyle = '#5d7a70'; g.fillText('★'.repeat(5 - n), x, 712); x += g.measureText('★'.repeat(5 - n)).width + 18;
  g.font = `700 38px ${FONT}`;
  g.fillStyle = '#b9c7c2'; g.fillText(`(${title})`, x, 716, W - x - X);
  g.fillStyle = '#fff';
  g.font = `800 66px ${FONT}`;
  g.fillText(daily ? 'Innathe road. Ninakku pattuo?' : 'Ninakku ithu kadakkan pattuo?', X, 820, W - X * 2);
  g.fillStyle = '#b9c7c2';
  g.font = `600 40px ${FONT}`;
  g.fillText(`${m + 1} m odi kaanikku 😏`, X, 905, W - X * 2);
  g.fillStyle = '#8fa49d';
  g.font = `600 36px ${FONT}`;
  g.fillText(url.replace(/^https?:\/\//, '').replace(/\/$/, ''), X, 980, W - X * 2);

  return new Promise((res) => c.toBlob(res, 'image/png'));
}

export async function share(blob, text) {
  const file = new File([blob], 'vandi-verse.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}
