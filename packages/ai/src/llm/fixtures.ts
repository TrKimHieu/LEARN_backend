import { readFileSync } from 'node:fs';

/**
 * Fixture "kịch bản sẵn" cho MockLlmProvider — cho phép chuẩn bị trước nội dung Lesson/Exercise
 * thật sự chỉn chu (thay vì để mock tự sinh nội dung chung chung từ chunk thô), để demo/quay video
 * trông giống AI đã xử lý thật. `sourceChunkIds` vẫn lấy từ chunk thật trong prompt — chỉ phần
 * "sáng tạo nội dung" (title/summary/contentMd/exercises) là được chuẩn bị trước.
 *
 * Dùng: đặt biến môi trường `MOCK_FIXTURES_PATH` trỏ tới 1 file JSON theo đúng type `MockFixtures`
 * bên dưới. Không set thì mock chạy như cũ (sinh nội dung chung chung bám chunk thật).
 */
export interface MockFixtureQuestion {
  type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'FILL_BLANK';
  prompt: string;
  explanation: string;
  // MULTIPLE_CHOICE
  options?: { content: string; isCorrect: boolean }[];
  // TRUE_FALSE
  statement?: string;
  answer?: boolean | string;
  // SHORT_ANSWER
  modelAnswer?: string;
  // FILL_BLANK
  blankHint?: string;
}

export interface MockFixtureExercise {
  title: string;
  instruction: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  questions: MockFixtureQuestion[];
}

export interface MockFixtureLesson {
  /** Chuỗi con để khớp — so khớp không phân biệt hoa/thường vào nội dung chunk gộp của node. */
  match: string;
  title: string;
  summary: string;
  contentMd: string;
  estimatedMinutes: number;
  exercises: MockFixtureExercise[];
}

export interface MockFixtures {
  lessons: MockFixtureLesson[];
}

export function loadMockFixtures(path: string | undefined): MockFixtures | null {
  if (!path) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as MockFixtures;
    if (!Array.isArray(parsed.lessons)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function findMatchingFixture(
  fixtures: MockFixtures | null,
  haystack: string,
): MockFixtureLesson | undefined {
  if (!fixtures) return undefined;
  const lower = haystack.toLowerCase();
  return fixtures.lessons.find((l) => lower.includes(l.match.toLowerCase()));
}
