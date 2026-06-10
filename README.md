# opencode-aiway-auth

opencode-aiway-auth 是一款 OpenCode 插件，用于 AI Way 的认证和模型发现。

## 安装

在 `~/.config/opencode/opencode.jsonc` 的 `plugin` 数组中添加 `"opencode-aiway-auth@latest"`。示例：

```jsonc
{
  // OpenCode plugins
  "plugin": [
    "opencode-aiway-auth@latest"
  ],
}
```

OpenCode 启动时会自动通过 npm 安装插件。

## 登录配置

*   CLI 方式：运行 `opencode auth` 或在 OpenCode CLI 中选择 `aiway` provider，选择 "AI Way API Key" 方式登录。
*   输入 AI Way 服务器地址（默认 `http://192.168.77.88`，可自定义）。
*   输入 API Key（格式 `sk-...`）。
*   登录成功后插件自动发现模型并写入配置。

## 功能特性

*   自动模型发现：通过 `/v1/models` API 获取所有可用模型。
*   自动协议选择：优先读取 `native_endpoint_types`，为不同模型选择正确的 OpenCode/AI SDK provider。
*   能力映射：自动识别 effort levels、thinking mode、输入模态（text/image/pdf/video）。
*   变体生成：为每个 effort level 生成变体（low/medium/high/max/xhigh）以及 thinking-disabled 变体。
*   Reasoning Effort 传递：自动将用户选择的变体（effort level）注入到对应协议的 provider options 中，确保 AI Way 服务端能收到正确 effort。
*   Token 限制：直接从 API 读取 context_window 和 max_output。
*   自动清理：退出登录后自动删除 provider 配置。
*   自动恢复：重新登录后自动恢复 provider 配置。

## 配置说明

登录后插件自动在 `opencode.jsonc` 中生成 `provider.aiway` 配置，包含所有发现的模型。用户无需手动配置 provider。如需自定义 AI Way 服务器地址，在登录时输入即可。

插件优先写入 `opencode.jsonc`，会用 JSONC 语法安全的局部编辑保留已有注释和尾逗号；如果旧 `opencode.json` 中存在历史生成的 `provider.aiway`，插件会自动清理该旧块，避免两个配置文件同时存在 provider 定义。

## 协议选择

插件根据 AI Way `/v1/models` 返回的 `native_endpoint_types` 为每个模型自动选择访问协议：

*   `responses` → `@ai-sdk/openai`，OpenCode 使用 Responses API。
*   `messages` → `@ai-sdk/anthropic`，OpenCode 使用 Claude Messages API。
*   `completions` → `@ai-sdk/openai-compatible`，OpenCode 使用 OpenAI-compatible Chat Completions API。

如果服务端没有返回 `native_endpoint_types`，插件会回退到模型 ID 和旧的 `supported_endpoint_types` 判断；仍无法判断时默认使用 `@ai-sdk/openai-compatible`。

## Reasoning Effort（变体）

插件会根据模型的 `effort_levels` 能力自动生成变体。在 OpenCode 中选择模型变体（如 `low`、`medium`、`high`）后，插件会按模型协议自动注入对应请求参数：

*   Messages / `@ai-sdk/anthropic`：写入 `providerOptions.anthropic.effort`。
*   Responses / `@ai-sdk/openai`：写入 `providerOptions.openai.reasoningEffort`。
*   Chat Completions / `@ai-sdk/openai-compatible`：写入 `providerOptions.openaiCompatible.reasoningEffort`，最终由 AI SDK 发送为 `reasoning_effort`。

支持的变体类型：

*   **Effort 变体**：`low`、`medium`、`high`、`max`、`xhigh`（取决于模型支持的 effort levels）。
*   **Thinking 变体**：`thinking-disabled`（关闭模型的 thinking 模式，适用于支持 adaptive/enabled thinking 的模型）。

变体选择方式：在 OpenCode 聊天界面中，选择模型后切换变体即可。无需手动配置。

## 日志

日志写入 `/tmp/opencode-aiway-auth.log`，API Key 不会被记录。

## 开发

```bash
npm install
npm run build        # 编译 TypeScript
npm run typecheck    # 仅类型检查
npm run integration  # 运行集成测试（需设置 AIWAY_API_KEY 环境变量）
```

## 许可证

MIT
