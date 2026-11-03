import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { env, isProd } from '../../environment';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Đường dẫn chứa bí mật (token) — chỉ in ra log ở dev, không bao giờ ở production. */
  secretLink?: string;
}

/**
 * Gửi thư. Hai chế độ (`MAIL_MODE`):
 * - `log` (mặc định, dev): không gửi gì, ghi thư ra log API để người phát triển tự mở đường dẫn.
 *   Ở production chế độ này không in đường dẫn — chỉ cảnh báo là thư không được gửi.
 * - `smtp`: gửi thật qua `SMTP_URL`.
 *
 * Lỗi gửi thư không được làm hỏng request gọi tới (ví dụ quên mật khẩu luôn trả 200 để không lộ
 * email nào tồn tại) — nên `send` trả `false` thay vì ném.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  async send(message: MailMessage): Promise<boolean> {
    if (env.MAIL_MODE === 'log') {
      if (isProd) {
        this.logger.warn(
          `MAIL_MODE=log ở production: thư "${message.subject}" KHÔNG được gửi. Đặt MAIL_MODE=smtp.`,
        );
        return false;
      }
      this.logger.log(
        `[MAIL_MODE=log] Tới: ${message.to} | ${message.subject}` +
          (message.secretLink ? ` | ${message.secretLink}` : ''),
      );
      return true;
    }

    try {
      this.transporter ??= createTransport(env.SMTP_URL);
      await this.transporter.sendMail({
        from: env.MAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      return true;
    } catch (err) {
      // Không log nội dung thư: có thể chứa đường dẫn đặt lại mật khẩu.
      this.logger.error(
        `Gửi thư "${message.subject}" thất bại: ${err instanceof Error ? err.message : 'lỗi không rõ'}`,
      );
      return false;
    }
  }
}
