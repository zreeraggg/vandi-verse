// WhatsApp share: sends text + link only. With an image file attached, WhatsApp on phones drops the caption (and the
// link with it), so the link goes alone and WhatsApp builds the tappable preview card from index.html's og:image.
export const distLabel = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(2)} KM`);

export function share(text) {
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}
