export interface Image {
  id: string;
  filename: string;
  originalName: string;
}

export type FitMode = 'contain' | 'cover' | 'scale-down';

export interface Poll {
  id: string;
  adminToken: string;
  shareToken: string | null;
  title: string;
  description: string;
  images: Image[];
  rounds: number;
  containerWidth: number;
  containerHeight: number;
  fitMode: FitMode;
  allowScrolling: boolean;
  showResults: boolean;
  showLabels: boolean;
  createdAt: number;
}

export interface Selection {
  round: number;
  leftImageId: string;
  rightImageId: string;
  winnerId: string;
}

export interface Vote {
  id: string;
  pollId: string;
  voterFingerprint: string;
  selections: Selection[];
  votedAt: number;
}

export interface VoterInfo {
  fingerprint: string;
  name: string;
  votedAt: number;
  selectionCount: number;
}

export interface PollResults {
  poll: Poll;
  votes: Vote[];
  imageStats: Record<string, { wins: number; appearances: number }>;
}

export type Pairing = {
  left: Image;
  right: Image;
  round: number;
};
