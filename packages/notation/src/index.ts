export interface ScoreAsset {
  scorePath: string;
  format: "musicxml";
}

export function scoreAsset(scorePath: string): ScoreAsset {
  return {
    scorePath,
    format: "musicxml"
  };
}