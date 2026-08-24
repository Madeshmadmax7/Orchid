import { OrderRepository } from './order.repository';
      export class OrderService {
        async createOrder(id: string) {
          if (!id) throw new Error("Missing order ID");
          return OrderRepository.save(id);
        }
      }