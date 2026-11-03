/**
 * Luật hoàn thành bài học: **mọi** bài tập của bài đều đã có ít nhất một lượt đạt ngưỡng
 * (`passScore`) của chính bài tập đó. Hàm thuần — service truyền điểm cao nhất của từng bài tập.
 */
export function isLessonComplete(
  exercises: ReadonlyArray<{ id: string; passScore: number }>,
  bestScoreByExercise: ReadonlyMap<string, number>,
): boolean {
  if (exercises.length === 0) return false;
  return exercises.every((e) => (bestScoreByExercise.get(e.id) ?? -1) >= e.passScore);
}
