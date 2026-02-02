import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export default function genesisPlugin(api: OpenClawPluginApi) {
  api.logger.info("Metaplex Genesis plugin loaded");
}
