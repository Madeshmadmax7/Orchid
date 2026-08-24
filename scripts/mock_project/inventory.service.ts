import { InventoryRepository } from './inventory.repository';
      export class InventoryService {
        async updateStock(id: string) {
          if (!id) throw new Error("Missing inventory ID");
          return InventoryRepository.find(id);
        }
      }