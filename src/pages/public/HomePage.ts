import { BasePage } from '../BasePage';

/** index.htm: marketing content plus the login panel. Login errors render on login.htm. */
export class HomePage extends BasePage {
  protected readonly path = 'index.htm';
}

/** login.htm: only reached via a failed login POST (title "ParaBank | Error"). */
export class LoginErrorPage extends BasePage {
  protected readonly path = 'login.htm';
}
