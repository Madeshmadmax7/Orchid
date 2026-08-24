import { UserService } from './user.service';
      export class UserController {
        private userService = new UserService();
        async getUser() {
          return this.userService.findUser("1");
        }
      }