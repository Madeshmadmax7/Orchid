import { PaymentService } from './payment.service';
      import { RefundService } from './refund.service';
      
      /**
       * Controller for API endpoints.
       */
      export class ApiController {
        private paymentService = new PaymentService();
        private refundService = new RefundService();
        
        /**
         * How does this API endpoint reach the database?
         * Handles incoming requests.
         */
        async handleRequest() {
          await this.paymentService.createPayment(100);
          await this.paymentService.verifyPayment("123");
        }
      }