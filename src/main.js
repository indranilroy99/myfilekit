import { appShell } from "./components/app-shell.js";
import { startRouter } from "./router.js";

const app = document.getElementById("app");
const routeOutlet = document.createElement("div");

app.replaceChildren(appShell(routeOutlet));
startRouter(routeOutlet);
