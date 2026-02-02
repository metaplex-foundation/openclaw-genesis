declare module "openclaw/plugin-sdk" {
  export interface OpenClawPluginApi {
    pluginConfig: unknown;
    logger: {
      info(message: string): void;
      warn(message: string): void;
      error(message: string): void;
      debug(message: string): void;
    };
    registerTool(tool: {
      name: string;
      label: string;
      description: string;
      parameters: unknown;
      execute(
        toolCallId: string,
        params: Record<string, unknown>
      ): Promise<{
        content: Array<{ type: string; text: string }>;
        details?: unknown;
      }>;
    }): void;
  }
}
