import confetti from "canvas-confetti";

export function dealClosedConfetti(cardElement?: HTMLElement) {
  const gold = "#C9A84C";
  const white = "#ffffff";
  const dark = "#1a1d27";

  let originX = 0.5;
  let originY = 0.5;

  if (cardElement) {
    const rect = cardElement.getBoundingClientRect();
    originX = (rect.left + rect.width / 2) / window.innerWidth;
    originY = (rect.top + rect.height / 2) / window.innerHeight;
  }

  confetti({
    particleCount: 80,
    spread: 70,
    origin: { x: originX, y: originY },
    colors: [gold, white, dark],
    ticks: 200,
    gravity: 1.2,
    scalar: 1.1,
  });

  setTimeout(() => {
    confetti({
      particleCount: 40,
      angle: 60,
      spread: 55,
      origin: { x: originX, y: originY },
      colors: [gold, white],
      ticks: 150,
    });
  }, 150);

  setTimeout(() => {
    confetti({
      particleCount: 40,
      angle: 120,
      spread: 55,
      origin: { x: originX, y: originY },
      colors: [gold, white],
      ticks: 150,
    });
  }, 300);
}

export function escrowTransitionEffect() {
  confetti({
    particleCount: 50,
    spread: 60,
    origin: { x: 0.5, y: 0.4 },
    colors: ["#C9A84C", "#D4B86A", "#E8CC8A"],
    ticks: 120,
    gravity: 0.8,
    scalar: 0.9,
    shapes: ["circle"],
  });
}
