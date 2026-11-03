import { z } from 'zod';

export const courseStatusSchema = z.enum(['DRAFT', 'READY', 'ARCHIVED']);
export type CourseStatus = z.infer<typeof courseStatusSchema>;

// Message tiếng Việt: các chuỗi này hiển thị thẳng cho người dùng ở form tạo
// khóa học, mặc định của Zod là tiếng Anh ("Too small: expected string…").
const courseTitleSchema = z
  .string()
  .min(1, { message: 'Vui lòng nhập tên khóa học.' })
  .max(200, { message: 'Tên khóa học tối đa 200 ký tự.' });
const courseDescriptionSchema = z
  .string()
  .max(2000, { message: 'Mô tả tối đa 2000 ký tự.' })
  .optional()
  .nullable();

export const createCourseSchema = z
  .object({
    title: courseTitleSchema,
    description: courseDescriptionSchema,
    language: z.enum(['vi', 'en']).default('vi'),
  })
  .strict();

export const patchCourseSchema = z
  .object({
    title: courseTitleSchema.optional(),
    description: z
      .string()
      .max(2000, { message: 'Mô tả tối đa 2000 ký tự.' })
      .nullable()
      .optional(),
    status: courseStatusSchema.optional(),
  })
  .strict();

export const reorderLessonsSchema = z
  .object({
    lessonIds: z.array(z.string().uuid()).min(1),
  })
  .strict();

export const courseSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  language: z.enum(['vi', 'en']),
  status: courseStatusSchema,
  progress: z.object({ completed: z.number().int(), total: z.number().int() }),
  documentCount: z.number().int(),
  lessonCount: z.number().int(),
  updatedAt: z.string(),
});

export const courseDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  language: z.enum(['vi', 'en']),
  status: courseStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  stats: z.object({
    completedLessons: z.number().int(),
    totalLessons: z.number().int(),
    averageScore: z.number().nullable(),
  }),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type PatchCourseInput = z.infer<typeof patchCourseSchema>;
export type ReorderLessonsInput = z.infer<typeof reorderLessonsSchema>;
export type CourseSummary = z.infer<typeof courseSummarySchema>;
export type CourseDetail = z.infer<typeof courseDetailSchema>;
