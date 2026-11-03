import { describe, it, expect } from 'vitest';
import { localDayKey, previousDayKey, utcDayKey } from '../progress.service';

const VN = 'Asia/Ho_Chi_Minh'; // UTC+7, không có giờ mùa hè
const NY = 'America/New_York'; // có giờ mùa hè — dùng để bắt lỗi cộng trừ 24 tiếng

describe('localDayKey', () => {
  it('cắt ngày theo múi giờ chứ không theo UTC', () => {
    // 22:00 UTC ngày 05/03 là 05:00 sáng ngày 06/03 ở Việt Nam.
    const t = new Date('2026-03-05T22:00:00Z');
    expect(utcDayKey(t)).toBe('2026-03-05');
    expect(localDayKey(t, VN)).toBe('2026-03-06');
  });

  // Đây là lý do đổi từ UTC sang APP_TIMEZONE: học lúc 1 giờ đêm giờ Việt Nam từng bị tính
  // sang ngày hôm trước, làm đứt chuỗi ngày học của người dùng một cách oan uổng.
  it('học lúc 1 giờ đêm giờ VN vẫn thuộc về ngày hôm đó', () => {
    const lateNight = new Date('2026-03-09T18:05:00Z'); // 01:05 ngày 10/03 giờ VN
    expect(localDayKey(lateNight, VN)).toBe('2026-03-10');
    expect(utcDayKey(lateNight)).toBe('2026-03-09'); // hành vi cũ — lệch một ngày
  });

  it('UTC vẫn dùng được khi cấu hình như vậy', () => {
    const t = new Date('2026-03-05T22:00:00Z');
    expect(localDayKey(t, 'UTC')).toBe('2026-03-05');
  });

  it('luôn trả định dạng YYYY-MM-DD có đệm số 0', () => {
    expect(localDayKey(new Date('2026-01-02T03:00:00Z'), 'UTC')).toBe('2026-01-02');
  });
});

describe('previousDayKey', () => {
  it('lùi một ngày', () => {
    expect(previousDayKey('2026-03-10')).toBe('2026-03-09');
  });

  it('lùi qua ranh giới tháng', () => {
    expect(previousDayKey('2026-03-01')).toBe('2026-02-28');
  });

  it('lùi qua ranh giới năm', () => {
    expect(previousDayKey('2026-01-01')).toBe('2025-12-31');
  });

  it('biết năm nhuận', () => {
    expect(previousDayKey('2028-03-01')).toBe('2028-02-29');
  });

  // Ở múi giờ có DST, "trừ 86400000 ms" có thể ra cùng một ngày hoặc nhảy hai ngày.
  // Vì lùi trên chuỗi lịch nên chuyện đó không xảy ra.
  it('không bị giờ mùa hè làm lệch', () => {
    // 08/03/2026 là ngày Mỹ chuyển sang giờ mùa hè.
    expect(previousDayKey('2026-03-09')).toBe('2026-03-08');
    expect(previousDayKey('2026-03-08')).toBe('2026-03-07');
    expect(localDayKey(new Date('2026-03-08T12:00:00Z'), NY)).toBe('2026-03-08');
  });

  it('lùi liên tiếp cho ra một dãy ngày liền mạch', () => {
    const days: string[] = [];
    let cursor = '2026-03-02';
    for (let i = 0; i < 4; i++) {
      days.push(cursor);
      cursor = previousDayKey(cursor);
    }
    expect(days).toEqual(['2026-03-02', '2026-03-01', '2026-02-28', '2026-02-27']);
  });
});
