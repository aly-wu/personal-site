// Hero carousel: replace these PNG paths with your own images in assets.
const heroImages = [
  "assets/svg1.png",
  "assets/svg2.png",
  "assets/svg3.png",
];

const heroImage = document.getElementById("heroCarouselImage");
let heroImageIndex = 0;

setInterval(() => {
  heroImage.style.opacity = "0";
  setTimeout(() => {
    heroImageIndex = (heroImageIndex + 1) % heroImages.length;
    heroImage.src = heroImages[heroImageIndex];
    heroImage.alt = `Portfolio preview placeholder ${heroImageIndex + 1}`;
    heroImage.style.opacity = "1";
  }, 300);
}, 1500);
