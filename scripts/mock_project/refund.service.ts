import { db } from './db';
      import { PaymentService } from './payment.service';
      /**
       * Handles refunds.
       */
      export class RefundService {
        async processRefund(paymentId: string) {
          return db.query('UPDATE payments SET refunded=true');
        }
      }