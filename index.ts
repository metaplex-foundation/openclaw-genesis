import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createCreateLaunchTool } from "./src/tools/createLaunch.js";
import { createAddLaunchpoolTool } from "./src/tools/addLaunchpool.js";
import { createAddUnlockedTool } from "./src/tools/addUnlocked.js";
import { createAddRaydiumPoolTool } from "./src/tools/addRaydiumPool.js";
import { createFinalizeLaunchTool } from "./src/tools/finalizeLaunch.js";
import { createLaunchStatusTool } from "./src/tools/launchStatus.js";
import type { UmiConfig } from "./src/umi.js";

export default function genesisPlugin(api: OpenClawPluginApi) {
  const pluginConfig = api.pluginConfig as UmiConfig | undefined;

  api.registerTool(createCreateLaunchTool(pluginConfig));
  api.registerTool(createAddLaunchpoolTool(pluginConfig));
  api.registerTool(createAddUnlockedTool(pluginConfig));
  api.registerTool(createAddRaydiumPoolTool(pluginConfig));
  api.registerTool(createFinalizeLaunchTool(pluginConfig));
  api.registerTool(createLaunchStatusTool(pluginConfig));

  api.logger.info(
    `Metaplex Genesis plugin loaded with ${6} tools ` +
      `(network: ${pluginConfig?.network ?? "mainnet"})`
  );
}
