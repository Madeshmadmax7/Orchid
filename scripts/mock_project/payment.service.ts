import { checkAuth } from './auth.service';
      import { db } from './db';
      /**
       * PaymentService handles creation and verification of payments.
       */
      export class PaymentService {
        async createPayment(amount: number) {
          checkAuth();
          return db.query('INSERT INTO payments...');
        }
        async verifyPayment(id: string) {
          const p = await db.query('SELECT * FROM payments WHERE id=' + id);
          if (!p) throw new Error("Validation fails");
          return true;
        }
      }