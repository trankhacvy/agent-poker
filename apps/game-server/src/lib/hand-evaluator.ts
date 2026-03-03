export function evaluateHand(
  cards: [number, number]
): { tier: string; percentile: number } {
  const rank1 = cards[0] % 13;
  const rank2 = cards[1] % 13;
  const suit1 = Math.floor(cards[0] / 13);
  const suit2 = Math.floor(cards[1] / 13);
  const suited = suit1 === suit2;
  const highRank = Math.max(rank1, rank2);
  const lowRank = Math.min(rank1, rank2);
  const gap = highRank - lowRank;
  const pair = rank1 === rank2;

  if (pair) {
    if (highRank >= 12) return { tier: "Premium", percentile: 1 };
    if (highRank >= 10) return { tier: "Premium", percentile: 3 };
    if (highRank >= 8) return { tier: "Strong", percentile: 6 };
    if (highRank >= 6) return { tier: "Good", percentile: 12 };
    if (highRank >= 4) return { tier: "Good", percentile: 18 };
    return { tier: "Playable", percentile: 30 };
  }

  if (highRank === 12) {
    if (lowRank >= 10)
      return {
        tier: suited ? "Premium" : "Strong",
        percentile: suited ? 4 : 7,
      };
    if (lowRank >= 8)
      return {
        tier: suited ? "Strong" : "Good",
        percentile: suited ? 8 : 14,
      };
    if (suited) return { tier: "Good", percentile: 20 };
    if (lowRank >= 7) return { tier: "Playable", percentile: 25 };
    return { tier: "Playable", percentile: 35 };
  }

  if (highRank === 11) {
    if (lowRank >= 10 && suited)
      return { tier: "Strong", percentile: 8 };
    if (lowRank >= 9)
      return { tier: "Good", percentile: suited ? 12 : 18 };
    if (suited) return { tier: "Playable", percentile: 25 };
    return { tier: "Playable", percentile: 35 };
  }

  if (suited) {
    if (gap === 1 && lowRank >= 4) return { tier: "Good", percentile: 20 };
    if (gap === 1) return { tier: "Playable", percentile: 35 };
    if (gap === 2 && lowRank >= 4)
      return { tier: "Playable", percentile: 30 };
    if (highRank >= 9) return { tier: "Playable", percentile: 30 };
    return { tier: "Weak", percentile: 55 };
  }

  if (lowRank >= 9) return { tier: "Good", percentile: 18 };

  if (gap === 1 && lowRank >= 6)
    return { tier: "Playable", percentile: 35 };
  if (gap === 1 && lowRank >= 3)
    return { tier: "Playable", percentile: 45 };

  if (highRank >= 9 && lowRank >= 6)
    return { tier: "Playable", percentile: 40 };

  return { tier: "Weak", percentile: 60 };
}
