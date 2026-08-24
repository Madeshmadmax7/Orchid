import { OrderService } from './order.service';
      export class OrderController {
        private service = new OrderService();
        async create() {
          await this.service.createOrder("1");
        }
      }