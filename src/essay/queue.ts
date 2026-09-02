export type DueProgress = { dueAt: string } | null

export function isReviewDue(progress: DueProgress, now = new Date()) {
  return progress === null || new Date(progress.dueAt).getTime() <= now.getTime()
}
