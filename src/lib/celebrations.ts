import confetti from "canvas-confetti";

export function dealClosedConfetti() {
  const gold = "#C9A84C";
  const white = "#ffffff";
  const dark = "#1a1d27";

  confetti({
    particleCount: 80,
    spread: 70,
    origin: { x: 0.5, y: 0.5 },
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
      origin: { x: 0, y: 0.6 },
      colors: [gold, white],
      ticks: 150,
    });
  }, 150);

  setTimeout(() => {
    confetti({
      particleCount: 40,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.6 },
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
