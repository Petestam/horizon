import { App } from "./app.js";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
const overlayRoot = document.getElementById("overlay-root");
if (!canvas || !overlayRoot) throw new Error("missing #stage or #overlay-root");

const app = new App(canvas, overlayRoot);
app.start();

if (import.meta.hot) import.meta.hot.dispose(() => app.stop());
