import { Poll, Vote, Image } from '../shared/types';

export interface ImageResult {
  imageId: string;
  wins: number;
  appearances: number;
  winRate: number;
  bradleyTerryScore: number;
}

export interface ResultsResponse {
  poll: { id: string; title: string; description: string; images: Image[]; rounds: number };
  totalVotes: number;
  imageStats: Record<string, { wins: number; appearances: number }>;
  rankings: ImageResult[];
}

function bradleyTerry(
  imageIds: string[],
  wins: Record<string, number>,
  pairCounts: Record<string, Record<string, number>>,
): Record<string, number> {
  const n = imageIds.length;
  if (n === 0) return {};

  const totalWins = Object.values(wins).reduce((a, b) => a + b, 0);
  if (totalWins === 0) {
    const score = 1 / n;
    return Object.fromEntries(imageIds.map(id => [id, score]));
  }

  const pi = new Array(n).fill(1 / n);

  for (let iter = 0; iter < 1000; iter++) {
    let maxDelta = 0;
    const newPi = [...pi];

    for (let i = 0; i < n; i++) {
      const idI = imageIds[i];
      const w = wins[idI] || 0;

      let denom = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const idJ = imageIds[j];
        const nIJ = pairCounts[idI]?.[idJ] || 0;
        if (nIJ > 0) {
          denom += nIJ / (pi[i] + pi[j]);
        }
      }

      if (denom > 0) {
        newPi[i] = w / denom;
      } else {
        newPi[i] = 0;
      }
      maxDelta = Math.max(maxDelta, Math.abs(newPi[i] - pi[i]));
    }

    const sum = newPi.reduce((a, b) => a + b, 0);
    for (let i = 0; i < n; i++) {
      pi[i] = sum > 0 ? newPi[i] / sum : 1 / n;
    }

    if (maxDelta < 1e-10) break;
  }

  return Object.fromEntries(imageIds.map((id, i) => [id, pi[i]]));
}

export function computeResults(poll: Poll, votes: Vote[]): ResultsResponse {
  const imageStats: Record<string, { wins: number; appearances: number }> = {};
  const pairCounts: Record<string, Record<string, number>> = {};

  for (const img of poll.images) {
    imageStats[img.id] = { wins: 0, appearances: 0 };
    pairCounts[img.id] = {};
    for (const other of poll.images) {
      pairCounts[img.id][other.id] = 0;
    }
  }

  for (const vote of votes) {
    for (const sel of vote.selections) {
      if (imageStats[sel.leftImageId]) imageStats[sel.leftImageId].appearances++;
      if (imageStats[sel.rightImageId]) imageStats[sel.rightImageId].appearances++;
      if (imageStats[sel.winnerId]) imageStats[sel.winnerId].wins++;
      if (pairCounts[sel.leftImageId] && pairCounts[sel.rightImageId]) {
        pairCounts[sel.leftImageId][sel.rightImageId]++;
        pairCounts[sel.rightImageId][sel.leftImageId]++;
      }
    }
  }

  const wins: Record<string, number> = {};
  for (const img of poll.images) {
    wins[img.id] = imageStats[img.id].wins;
  }

  const btScores = bradleyTerry(poll.images.map(i => i.id), wins, pairCounts);

  const rankings: ImageResult[] = poll.images.map(img => ({
    imageId: img.id,
    wins: imageStats[img.id].wins,
    appearances: imageStats[img.id].appearances,
    winRate: imageStats[img.id].appearances > 0
      ? imageStats[img.id].wins / imageStats[img.id].appearances
      : 0,
    bradleyTerryScore: btScores[img.id] ?? 0,
  }));

  rankings.sort((a, b) => b.bradleyTerryScore - a.bradleyTerryScore);

  return {
    poll: {
      id: poll.id,
      title: poll.title,
      description: poll.description,
      images: poll.images,
      rounds: poll.rounds,
    },
    totalVotes: votes.length,
    imageStats,
    rankings,
  };
}
