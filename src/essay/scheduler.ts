export type ReviewRating = "forgot" | "hard" | "remembered";

export type ReviewProgress = {
  repetitions: number;
  intervalDays: number;
  ease: number;
  rememberedCount: number;
  forgotCount: number;
};

export const initialProgress: ReviewProgress = {
  repetitions: 0,
  intervalDays: 0,
  ease: 2.3,
  rememberedCount: 0,
  forgotCount: 0,
};

export function scheduleReview(
  progress: ReviewProgress,
  rating: ReviewRating,
  now = new Date(),
) {
  let repetitions = progress.repetitions;
  let intervalDays = progress.intervalDays;
  let ease = progress.ease;
  let rememberedCount = progress.rememberedCount;
  let forgotCount = progress.forgotCount;

  if (rating === "forgot") {
    repetitions = 0;
    intervalDays = 1;
    ease = Math.max(1.3, ease - 0.2);
    forgotCount += 1;
  } else if (rating === "hard") {
    intervalDays = Math.max(1, Math.round((intervalDays || 1) * 1.2));
    ease = Math.max(1.3, ease - 0.05);
  } else {
    repetitions += 1;
    intervalDays =
      repetitions === 1
        ? 1
        : repetitions === 2
          ? 3
          : Math.max(4, Math.round(intervalDays * ease));
    ease = Math.min(2.6, ease + 0.1);
    rememberedCount += 1;
  }

  const dueAt = new Date(now.getTime() + intervalDays * 86400000).toISOString();
  return {
    repetitions,
    intervalDays,
    ease: Number(ease.toFixed(2)),
    rememberedCount,
    forgotCount,
    dueAt,
    lastReviewedAt: now.toISOString(),
  };
}
