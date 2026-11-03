import { Injectable } from '@nestjs/common';
import { newId } from '@learn/db';
import { PrismaService, type Db } from '../../../../infra/services';

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Ghi Payment — chỉ chạy trong transaction (billing demo), nhưng method vẫn nhận `db`. */
  create(
    data: {
      subscriptionId: string;
      amountCents: number;
      currency: string;
      status: string;
      providerPaymentId: string;
      paidAt: Date;
    },
    db: Db,
  ) {
    return db.payment.create({ data: { id: newId(), ...data } });
  }
}
