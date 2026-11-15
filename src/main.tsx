import { createRoot } from "react-dom/client";
import "@fontsource-variable/space-grotesk";
import "./base.css";
import "./gemsurge.css";
import { connect } from "../sdk/dingn-sdk.js";
import { DingnProvider } from "./dingn";
import { GemGame } from "./game";
import { loadSaved } from "./save";

const sdk = await connect();
document.documentElement.lang = sdk.locale;
const [saved, prefs] = await Promise.all([
  loadSaved(sdk),
  sdk.storage.get("prefs").catch(() => null),
]);
const p = prefs && typeof prefs === "object" && !Array.isArray(prefs) ? prefs : {};
createRoot(document.getElementById("root")!).render(
  <DingnProvider sdk={sdk}>
    <GemGame initial={saved} prefs={{ muted: p.muted === true }} />
  </DingnProvider>,
);
sdk.ready();
