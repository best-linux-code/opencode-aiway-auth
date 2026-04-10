# opencode-aiway-auth

opencode-aiway-auth 是一款 OpenCode 插件，用于 AI Way 的认证和模型发现。

## 安装

在 `~/.config/opencode/opencode.json` 的 `plugin` 数组中添加 `"opencode-aiway-auth@latest"`。示例：

```json
{
  "plugin": [
    "opencode-aiway-auth@latest"
  ]
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
*   能力映射：自动识别 effort levels、thinking mode、输入模态（text/image/pdf/video）。
*   变体生成：为每个 effort level 生成变体（low/medium/high/max/xhigh）以及 thinking-disabled 变体。
*   Token 限制：直接从 API 读取 context_window 和 max_output (v1.0.5+)。
*   自动清理：退出登录后自动删除 provider 配置。
*   自动恢复：重新登录后自动恢复 provider 配置。

## 配置说明

登录后插件自动在 `opencode.json` 中生成 `provider.aiway` 配置，包含所有发现的模型。用户无需手动配置 provider。如需自定义 AI Way 服务器地址，在登录时输入即可。

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
