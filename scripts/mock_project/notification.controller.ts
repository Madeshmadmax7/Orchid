import { NotificationService } from './notification.service';
      export class NotificationController {
        private notifyService = new NotificationService();
        async create() {
          return this.notifyService.send("Hello");
        }
      }