import "./index.css";

import { ready } from "./i18n";

// Labels such as the menu are built when their modules load, so the active language's
// dictionary must be in place before the app is imported. English needs no download.
void ready.then(() => import("./bootstrap"));
