# MDC AI 翻译扩展

上游仓库未公开 MDC 的应用源码。本扩展从现有 `mdcng/mdc:beta` 镜像构建，保留 MDC 原有程序，另在同一容器内启动兼容 Deeplx 的 AI 翻译服务。它不更改原程序的文件名解析代码。

1. 将容器镜像改为 `ghcr.io/michu0126/mdc:extension-latest`，保留已有 `/config`、`/media` 挂载和 9208 端口，再映射 `9209:9209`。
2. 首次启动会在 `/config/mdc-ai-admin-token.txt` 生成设置页面密码。用 `admin` 和文件中的密码登录 `http://NAS地址:9209/`。
3. 填写 OpenAI 兼容接口的基础地址、API Key 和模型。可以获取接口提供的模型列表，也可以直接填写模型 ID。密钥只写入 `/config/mdc-ai.json`，设置页不会回显。
4. 在 MDC「设置 → 元数据」中选择 `Deeplx`，把接口地址设为 `http://127.0.0.1:9209/translate`，再保存。

`/translate` 只接受容器内部的本机连接，以免局域网中的其他设备调用付费 AI 接口。API 服务可以连 OpenAI 或任何兼容 Chat Completions 的服务。请使用可信的 HTTPS 服务；若使用局域网内的自建服务，也可以填写 HTTP 地址。
